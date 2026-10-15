import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // two pages: the landing page at / and the studio at /studio/
  build: { rollupOptions: { input: { landing: 'index.html', studio: 'studio/index.html' } } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
