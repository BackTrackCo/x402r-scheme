import { defineConfig } from 'tsup'

const baseConfig = {
  entry: {
    index: 'src/escrow/index.ts',
    'escrow/client/index': 'src/escrow/client/index.ts',
    'escrow/server/index': 'src/escrow/server/index.ts',
    'escrow/facilitator/index': 'src/escrow/facilitator/index.ts',
    'extensions/attestation/index': 'src/extensions/attestation/index.ts',
  },
  dts: { resolve: true },
  sourcemap: true,
  target: 'es2020',
}

export default defineConfig([
  { ...baseConfig, format: 'esm', outDir: 'dist/esm', clean: true },
  { ...baseConfig, format: 'cjs', outDir: 'dist/cjs', clean: false },
])
