import { defineConfig } from "vite";
export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist-server",
    target: "node22",
    rollupOptions: {
      input: {
        index: "server/index.ts",
        verify: "server/verify.ts",
        convert: "scripts/convert-training-log.ts",
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
