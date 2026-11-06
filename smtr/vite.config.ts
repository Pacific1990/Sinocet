import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset URLs allow the web app to live at /smtr/ on a shared host.
export default defineConfig({
  base: '/smtr/',
  plugins: [react()],
  server: { host: '0.0.0.0' },
  build: { outDir: 'dist' },
});
