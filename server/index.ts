import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { AnalysisError, generateAnalysis } from "./analysis";
const root = resolve(process.env.TRAINTRACE_DIST ?? "dist-local");
const config = {
  key: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL,
};
let running = 0;
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  let data = "",
    size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 256000) throw new AnalysisError(413, "训练数据过大");
    data += chunk;
  }
  try {
    return JSON.parse(data);
  } catch {
    throw new AnalysisError(400, "请求格式无效");
  }
}
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/api/training-analysis") {
      if (req.method !== "POST")
        return json(res, 405, { error: "仅支持主动请求分析" });
      // Same-origin UI only. No permissive CORS and no cross-site calls using the server key.
      if (
        req.headers["sec-fetch-site"] === "cross-site" ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host)
      )
        return json(res, 403, { error: "来源无效" });
      if (running >= 2) return json(res, 429, { error: "请稍后重试" });
      running++;
      try {
        return json(
          res,
          200,
          await generateAnalysis(await body(req), config, fetch, (metrics) =>
            console.info("DeepSeek analysis", JSON.stringify(metrics)),
          ),
        );
      } finally {
        running--;
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "请求方法无效" });
    const file = resolve(
      root,
      `.${decodeURIComponent(path === "/" ? "/index.html" : path)}`,
    );
    if (!file.startsWith(root + sep))
      return json(res, 404, { error: "文件不存在" });
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      return json(res, 404, { error: "文件不存在" });
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    json(res, error instanceof AnalysisError ? error.status : 500, {
      error: error instanceof AnalysisError ? error.message : "服务暂不可用",
      code: error instanceof AnalysisError ? error.code : "server_error",
    });
  }
});
server.requestTimeout = 50000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT ?? 8787),
  process.env.HOST ?? "127.0.0.1",
  () => console.log("TrainTrace 服务已启动，端口", process.env.PORT ?? 8787),
);
