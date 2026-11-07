import { defineConfig } from 'vite';
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
        target: process.env.SMTR_DEV_API_TARGET || 'http://127.0.0.1:4010',
        changeOrigin: false,
      },
      '/smtr/ws': {
        target: (process.env.SMTR_DEV_API_TARGET || 'http://127.0.0.1:4010').replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist' },
});
