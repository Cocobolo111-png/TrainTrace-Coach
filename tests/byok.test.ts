import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createTrainTraceServer } from "../server/http";
import {
  analysisInput,
  analysisSignature,
  cachedAnalysis,
} from "../src/analysis";
import { writeAnalysisCache } from "../src/storage";
import { generateAnalysis } from "../server/analysis";
import { evaluateTraining } from "../src/feedback";
import {
  syntheticProfile as profile,
  syntheticWorkout as workout,
} from "./fixtures";
import {
  connectAI,
  disconnectAI,
  connectionRequest,
  connectionSnapshot,
} from "../src/aiConnection";
import { ANALYSIS_VERSION } from "../src/model";
const servers: ReturnType<typeof createTrainTraceServer>[] = [];
afterEach(async () => {
  disconnectAI();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
});
const reply = {
  summary: "本次留下了真实训练记录。",
  progress: "",
  insight: "保持记录，供下次比较。",
  nextAction: "模型擅自建议增加100kg",
};
function provider() {
  return vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/models")
      ? Response.json({
          data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }],
        })
      : Response.json({
          model: "deepseek-flash",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(reply) },
            },
          ],
        }),
  );
}
async function service(fetcher = provider()) {
  const s = createTrainTraceServer({
    mode: "byok",
    origin: "https://train.example",
    root: "dist",
    fetcher,
    local: { key: "developer-env-must-never-be-used" },
  });
  servers.push(s);
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const request = (
    path = "/api/ai/connect",
    data: unknown = { provider: "deepseek", model: "deepseek-flash" },
    overrides: Record<string, string | null | undefined> = {},
  ) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      host: "train.example",
      origin: "https://train.example",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
      authorization: "Bearer synthetic-key-not-real",
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null) delete headers[k];
      else headers[k] = v;
    }
    return new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        url + path,
        { method: "POST", headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve(
              new Response(Buffer.concat(chunks), { status: res.statusCode }),
            ),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(data));
    });
  };
  return { request, fetcher, url };
}
describe("BYOK boundary", () => {
  it("requires an exact HTTPS deployment origin", () => {
    expect(() =>
      createTrainTraceServer({
        mode: "byok",
        root: "dist",
        origin: "http://train.example",
      }),
    ).toThrow();
  });
  it("never falls back to developer credentials", async () => {
    const { request, fetcher } = await service();
    expect(
      (await request(undefined, undefined, { authorization: null })).status,
    ).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, missing origin, incorrect transport and foreign host before forwarding", async () => {
    const { request, fetcher } = await service();
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: null },
      { "x-forwarded-proto": "http" },
      { host: "evil.example" },
      { "sec-fetch-site": "same-site" },
    ])
      expect((await request(undefined, undefined, headers)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects arbitrary endpoint, provider and query credentials", async () => {
    const { request, fetcher } = await service();
    for (const data of [
      { provider: "openai", model: "deepseek-flash" },
      {
        provider: "deepseek",
        model: "deepseek-flash",
        endpoint: "https://evil.example",
      },
      { provider: "deepseek", model: "unknown" },
    ])
      expect((await request(undefined, data)).status).toBe(400);
    expect((await request("/api/ai/connect?key=synthetic")).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("connects only to fixed official endpoint with no training context", async () => {
    const { request, fetcher } = await service();
    expect((await request()).status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/models");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
  });
  it("sanitizes provider authentication failures", async () => {
    const fake = vi.fn<typeof fetch>(
      async () => new Response("secret provider diagnostics", { status: 401 }),
    );
    const { request } = await service(fake);
    const response = await request();
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("secret");
  });
  it("bounds size and per-credential request frequency", async () => {
    const { request } = await service();
    expect(
      (await request(undefined, { padding: "a".repeat(256001) })).status,
    ).toBe(413);
    for (let i = 0; i < 11; i++) expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
  });
  it("limits concurrency without forwarding excess requests", async () => {
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const fake = vi.fn<typeof fetch>(async () => {
      await wait;
      return Response.json({ data: [{ id: "deepseek-flash" }] });
    });
    const { request } = await service(fake);
    const first = request(),
      second = request();
    await vi.waitFor(() => expect(fake).toHaveBeenCalledTimes(2));
    expect((await request()).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });
  it("cancels provider transport when the requesting browser disconnects", async () => {
    let signal: AbortSignal | undefined;
    const fake = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) =>
        signal!.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        ),
      );
    });
    const { url } = await service(fake);
    const request = httpRequest(url + "/api/ai/connect", {
      method: "POST",
      headers: {
        host: "train.example",
        origin: "https://train.example",
        "x-forwarded-proto": "https",
        "Content-Type": "application/json",
        authorization: "Bearer synthetic-key",
      },
    });
    request.on("error", () => {});
    request.end(
      JSON.stringify({ provider: "deepseek", model: "deepseek-flash" }),
    );
    await vi.waitFor(() => expect(fake).toHaveBeenCalledOnce());
    request.destroy();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
  it("reuses one model call, sends selected dimensions, and retains rule nextAction", async () => {
    const { request, fetcher } = await service();
    const input = analysisInput(workout(15), [workout(13)], profile, {
      provider: "deepseek",
      model: "deepseek-flash",
      dimensions: ["volume"],
    });
    const r = await request("/api/training-analysis", input);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.nextAction).toBe(
      evaluateTraining(input.current, input.history, profile).primary.action,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const context = JSON.parse(sent.messages[1].content);
    expect(context.analysisDimensions).toEqual(["volume"]);
    expect(context.training.sets).toBe(3);
    expect(context.feedback.exercises[0].current.volume).toBe(1440);
    expect(context.explainers.length).toBeLessThanOrEqual(2);
  });
  it("separates caches by facts, version, dimensions and actual model without key identity", async () => {
    const input = analysisInput(workout(20), [workout(18)], profile);
    const value = await generateAnalysis(
      input,
      { key: "synthetic-key" },
      provider(),
    );
    await writeAnalysisCache(input.current.id, analysisSignature(input), value);
    expect(await cachedAnalysis(input)).not.toBeNull();
    expect(
      await cachedAnalysis({
        ...input,
        ai: { ...input.ai, dimensions: ["volume"] },
      }),
    ).toBeNull();
    expect(
      await cachedAnalysis({
        ...input,
        ai: { ...input.ai, model: "deepseek-v4-pro" },
      }),
    ).toBeNull();
    await writeAnalysisCache(input.current.id, analysisSignature(input), {
      ...value,
      meta: { ...value.meta, model: "different-actual-model" },
    });
    expect(await cachedAnalysis(input)).toBeNull();
    expect(analysisSignature(input)).not.toContain("synthetic-key");
    expect(input.analysisVersion).toBe(ANALYSIS_VERSION);
  });
  it("clears memory and aborts credential use on disconnect", async () => {
    vi.stubEnv("MODE", "byok");
    vi.stubGlobal("location", { protocol: "https:" });
    vi.stubGlobal("document", { baseURI: "https://train.example/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ provider: "deepseek", model: "deepseek-flash" }),
      ),
    );
    await connectAI("synthetic-key-not-real", "deepseek-flash");
    const active = connectionRequest();
    expect(connectionSnapshot()?.model).toBe("deepseek-flash");
    disconnectAI();
    expect(active.signal.aborted).toBe(true);
    expect(connectionSnapshot()).toBeNull();
    expect(() => connectionRequest()).toThrow();
  });
});
