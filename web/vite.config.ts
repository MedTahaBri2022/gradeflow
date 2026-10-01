/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5175,
    // Same-origin in development: no CORS preflight on every request.
    proxy: { '/api': 'http://localhost:3002' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
