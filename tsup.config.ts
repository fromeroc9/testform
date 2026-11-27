import { defineConfig } from 'tsup';

const external = [
  '@aws-sdk/client-s3',
  '@aws-sdk/client-dynamodb',
  '@azure/storage-blob',
  '@google-cloud/storage',
  'docx',
  'exceljs',
  'typescript',
];

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    dts: false,
    splitting: false,
    sourcemap: false,
    minify: true,
    clean: false,
    external,
  },
  {
    entry: ['src/sdk.ts'],
    format: ['cjs'],
    target: 'es2022',
    platform: 'node',
    outDir: 'dist',
    dts: true,
    splitting: false,
    sourcemap: false,
    minify: false,
    clean: false,
    tsconfig: 'tsconfig.sdk.json',
    external,
  },
]);
