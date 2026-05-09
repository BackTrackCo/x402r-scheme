import { defineConfig } from "tsup";

const baseConfig = {
  entry: {
    index: "src/authCapture/index.ts",
    "authCapture/client/index": "src/authCapture/client/index.ts",
    "authCapture/server/index": "src/authCapture/server/index.ts",
    "authCapture/facilitator/index": "src/authCapture/facilitator/index.ts",
  },
  dts: { resolve: true },
  sourcemap: true,
  target: "es2020",
};

export default defineConfig([
  { ...baseConfig, format: "esm", outDir: "dist/esm", clean: true },
  { ...baseConfig, format: "cjs", outDir: "dist/cjs", clean: false },
]);
