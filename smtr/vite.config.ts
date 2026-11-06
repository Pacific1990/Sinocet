import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// PDF-based interface under /smtr/. Development proxy is local only.
// No direct browser access to SQL and no synthetic API data.
export default defineConfig({
  base: '/smtr/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/smtr/api/v1': {
        target: 'http://127.0.0.1:4010',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist' },
  test: { include: ['src/**/*.test.ts','src/**/*.test.tsx'] },
});
