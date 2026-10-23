import { createTrainTraceServer } from "./http";
const local = process.argv.includes("--local");
// Default is public BYOK, without any developer credential fallback.
const server = createTrainTraceServer({
  mode: local ? "local" : "byok",
  root: process.env.TRAINTRACE_DIST ?? (local ? "dist-local" : "dist-byok"),
  origin: process.env.PUBLIC_ORIGIN,
  local: local
    ? { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL }
    : undefined,
});
server.listen(
  Number(process.env.PORT ?? (local ? 8787 : 8788)),
  "127.0.0.1",
  () =>
    console.log(
      `TrainTrace ${local ? "private local" : "BYOK"} service ready on loopback`,
    ),
);
