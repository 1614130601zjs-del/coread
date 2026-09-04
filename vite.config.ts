import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.COREAD_BASE_PATH || '/',
  plugins: [react()],
  root: 'web',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
});
