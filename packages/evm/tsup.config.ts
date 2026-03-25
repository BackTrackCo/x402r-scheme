import { defineConfig } from 'tsup'

const baseConfig = {
  entry: {
    index: 'src/commerce/index.ts',
    'commerce/client/index': 'src/commerce/client/index.ts',
    'commerce/server/index': 'src/commerce/server/index.ts',
    'commerce/facilitator/index': 'src/commerce/facilitator/index.ts',
  },
  dts: { resolve: true },
  sourcemap: true,
  target: 'es2020',
}

export default defineConfig([
  { ...baseConfig, format: 'esm', outDir: 'dist/esm', clean: true },
  { ...baseConfig, format: 'cjs', outDir: 'dist/cjs', clean: false },
])
