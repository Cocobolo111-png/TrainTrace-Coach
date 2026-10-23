// Isolated HTTPS test surface; generated certificate is never used in deployment.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { request } from "node:http";
import { createTrainTraceServer } from "../dist-server/http.js";
const directory = mkdtempSync(join(tmpdir(), "traintrace-tls-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
  ],
  { stdio: "ignore" },
);
const backend = createTrainTraceServer({
  mode: "byok",
  root: "dist-byok",
  origin: "https://127.0.0.1:14175",
});
backend.listen(0, "127.0.0.1", () => {
  const tls = createServer(
    {
      key: readFileSync(join(directory, "key.pem")),
      cert: readFileSync(join(directory, "cert.pem")),
    },
    (req, res) => {
      const upstream = request(
        {
          hostname: "127.0.0.1",
          port: backend.address().port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, "x-forwarded-proto": "https" },
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  tls.listen(14175, "127.0.0.1");
  const close = () => {
    tls.closeAllConnections();
    tls.close();
    backend.closeAllConnections();
    backend.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit();
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
});
