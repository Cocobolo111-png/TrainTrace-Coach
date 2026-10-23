// Explicit paid verification with SYNTHETIC fixtures only. Never runs on startup or CI.
import { once } from "node:events";
import { request } from "node:http";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createTrainTraceServer } from "./http";
import { analysisInput } from "../src/analysis";
import { evaluateTraining } from "../src/feedback";
import {
  syntheticProfile as profile,
  syntheticWorkout as workout,
} from "../tests/fixtures";
const output = process.argv[2],
  key = process.env.DEEPSEEK_API_KEY;
if (!output || !key)
  throw Error("Requires explicit output path and local environment credential");
const server = createTrainTraceServer({
  mode: "byok",
  root: "dist-byok",
  origin: "https://train.example",
  local: { key: "must-not-fallback" },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
async function post(path: string, body: unknown, credential?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        path,
        method: "POST",
        headers: {
          host: "train.example",
          origin: "https://train.example",
          "x-forwarded-proto": "https",
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
try {
  const connection = await post(
    "/api/ai/connect",
    { provider: "deepseek", model: "deepseek-flash" },
    key,
  );
  if (connection.status !== 200) throw Error("Connection verification failed");
  const invalid = await post(
    "/api/ai/connect",
    { provider: "deepseek", model: "deepseek-flash" },
    "synthetic-invalid-key",
  );
  const missing = await post("/api/ai/connect", {
    provider: "deepseek",
    model: "deepseek-flash",
  });
  const cases = [
    {
      name: "same-load-more-reps",
      current: workout(20, [8, 10, 8]),
      history: [workout(18)],
      dimensions: ["progress", "next"] as const,
      model: "deepseek-flash" as const,
    },
    {
      name: "single-drop",
      current: workout(20, [8, 8, 7]),
      history: [workout(18)],
      dimensions: ["progress", "next"] as const,
      model: "deepseek-flash" as const,
    },
    {
      name: "returning",
      current: {
        ...workout(20, [8, 8], 40),
        recovery: true,
        note: "明确自述：停训三周后保守复训（合成验收场景）",
      },
      history: [workout(1)],
      dimensions: ["progress", "next"] as const,
      model: "deepseek-flash" as const,
    },
    {
      name: "first-record-volume",
      current: workout(20),
      history: [],
      dimensions: ["volume"] as const,
      model: "deepseek-v4-pro" as const,
    },
    {
      name: "stable",
      current: workout(20),
      history: [workout(18)],
      dimensions: ["progress"] as const,
      model: "deepseek-flash" as const,
    },
  ];
  const results = [];
  for (const c of cases) {
    const input = analysisInput(c.current, c.history, profile, {
      provider: "deepseek",
      model: c.model,
      dimensions: [...c.dimensions],
    });
    const response = await post("/api/training-analysis", input, key);
    const rules = evaluateTraining(c.current, c.history, profile);
    if (
      response.status !== 200 ||
      response.body.nextAction !== rules.primary.action
    )
      throw Error("Analysis verification failed");
    results.push({
      case: c.name,
      model: c.model,
      dimensions: c.dimensions,
      ruleStatus: rules.primary.status,
      result: response.body,
    });
    console.log(c.name, response.status, response.body.meta.model);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        source: "synthetic-fixtures-not-personal-records",
        verifiedAt: new Date().toISOString(),
        transport:
          "loopback HTTP with tested TLS-terminator headers; provider HTTPS fully validated; browser HTTPS tested separately",
        connection: connection.status,
        invalidCredential: invalid.status,
        missingCredentialWithDeveloperConfig: missing.status,
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} catch {
  console.error(
    "Live verification incomplete; no credentials or raw provider diagnostics emitted.",
  );
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
