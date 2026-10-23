import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname, sep } from "node:path";
import { z } from "zod";
import { AIOptionsSchema, models } from "../src/aiConfig";
import { AnalysisError, generateAnalysis, type ModelConfig } from "./analysis";
export type ServerConfig = {
  mode: "local" | "byok";
  root: string;
  origin?: string;
  local?: ModelConfig;
  fetcher?: typeof fetch;
};
const ConnectSchema = AIOptionsSchema.omit({ dimensions: true });
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const fail = (status: number, code: string) =>
  new AnalysisError(status, "请求未完成，请检查连接或稍后重试。", code);
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? ""))
    throw fail(415, "invalid_input");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256000) throw fail(413, "invalid_input");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw fail(400, "invalid_input");
  }
}
function credential(req: IncomingMessage) {
  const match = /^Bearer ([\x21-\x7e]{8,512})$/.exec(
    req.headers.authorization ?? "",
  );
  if (!match) throw fail(401, "authentication");
  return match[1];
}
export function createTrainTraceServer(config: ServerConfig) {
  const root = resolve(config.root),
    fetcher = config.fetcher ?? fetch;
  if (
    config.mode === "byok" &&
    (!config.origin ||
      new URL(config.origin).protocol !== "https:" ||
      new URL(config.origin).origin !== config.origin)
  )
    throw Error("BYOK requires an exact HTTPS PUBLIC_ORIGIN");
  let running = 0;
  const rates = new Map<string, { at: number; count: number }>();
  function rate(id: string, maximum: number) {
    const now = Date.now();
    for (const [k, v] of rates) if (now - v.at >= 60000) rates.delete(k);
    let bucket = rates.get(id);
    if (!bucket) {
      if (rates.size >= 4096) throw fail(429, "rate_limit");
      bucket = { at: now, count: 0 };
      rates.set(id, bucket);
    }
    if (++bucket.count > maximum) throw fail(429, "rate_limit");
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (
          !["/api/ai/connect", "/api/training-analysis"].includes(url.pathname)
        )
          throw fail(404, "invalid_input");
        if (req.method !== "POST") throw fail(405, "invalid_input");
        if (url.search) throw fail(400, "invalid_input");
        const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress ?? "",
        );
        if (
          !loopback ||
          ["cross-site", "same-site"].includes(
            String(req.headers["sec-fetch-site"]),
          )
        )
          throw fail(403, "origin");
        const expected =
          config.mode === "byok" ? config.origin : `http://${req.headers.host}`;
        if (config.mode === "byok") {
          // Only a loopback TLS terminator may assert transport. Bind the service to loopback.
          if (
            req.headers.origin !== expected ||
            req.headers.host !== new URL(expected!).host ||
            req.headers["x-forwarded-proto"] !== "https"
          )
            throw fail(403, "origin");
        } else if (req.headers.origin && req.headers.origin !== expected)
          throw fail(403, "origin");
        rate("transport:" + req.socket.remoteAddress, 60);
        const key =
          config.mode === "byok" ? credential(req) : config.local?.key;
        // Digest is ephemeral rate bookkeeping, never a cache identity or log field.
        if (key)
          rate(
            "credential:" + createHash("sha256").update(key).digest("hex"),
            12,
          );
        if (running >= 2) throw fail(429, "rate_limit");
        running++;
        try {
          const raw = await body(req);
          let options;
          if (config.mode === "byok") {
            if (url.pathname === "/api/ai/connect") {
              const parsed = ConnectSchema.safeParse(raw);
              if (!parsed.success) throw fail(400, "invalid_input");
              options = parsed.data;
            } else {
              // Reject endpoint/key injection and unexpected top-level forwarding options.
              const parsed = z
                .object({
                  version: z.string(),
                  analysisVersion: z.string(),
                  current: z.unknown(),
                  history: z.array(z.unknown()),
                  profile: z.unknown(),
                  ai: AIOptionsSchema,
                })
                .strict()
                .safeParse(raw);
              if (!parsed.success) throw fail(400, "invalid_input");
              options = parsed.data.ai;
            }
          }
          if (url.pathname === "/api/ai/connect") {
            if (!options || !key) throw fail(400, "invalid_input");
            let response: Response;
            try {
              response = await fetcher("https://api.deepseek.com/models", {
                headers: { Authorization: `Bearer ${key}` },
                redirect: "error",
                signal: AbortSignal.timeout(12000),
              });
            } catch {
              throw fail(502, "provider_unavailable");
            }
            if (!response.ok)
              throw fail(
                response.status === 401 || response.status === 403
                  ? 401
                  : response.status === 429
                    ? 429
                    : 502,
                response.status === 401 || response.status === 403
                  ? "authentication"
                  : response.status === 429
                    ? "rate_limit"
                    : "provider_unavailable",
              );
            const data = await response.json().catch(() => null);
            if (
              !data?.data?.some(
                (m: { id?: string }) => m.id === options.model,
              ) ||
              !models.includes(options.model)
            )
              throw fail(400, "invalid_model");
            return json(res, 200, {
              provider: "deepseek",
              model: options.model,
            });
          }
          return json(
            res,
            200,
            await generateAnalysis(
              raw,
              { key, model: options?.model ?? config.local?.model },
              fetcher,
            ),
          );
        } finally {
          running--;
        }
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw fail(405, "invalid_input");
      const path = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      const file = resolve(root, `.${path}`);
      if (
        !file.startsWith(root + sep) ||
        path.split("/").some((part) => part.startsWith("."))
      )
        throw fail(404, "invalid_input");
      const data = await readFile(file).catch(() => null);
      if (!data) throw fail(404, "invalid_input");
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (!res.headersSent)
        json(res, error instanceof AnalysisError ? error.status : 500, {
          error:
            error instanceof AnalysisError ? error.message : "服务暂不可用",
          code: error instanceof AnalysisError ? error.code : "server_error",
        });
      else res.end();
    }
  });
  server.requestTimeout = 50000;
  server.headersTimeout = 10000;
  return server;
}
