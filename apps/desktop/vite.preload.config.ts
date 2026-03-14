import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-browser/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@agent-browser/selector': path.resolve(__dirname, '../../packages/selector/src/index.ts'),
    },
  },
});
