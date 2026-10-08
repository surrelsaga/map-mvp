import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                                    // relative paths, so the build works at any URL (GitHub Pages serves it under /map-mvp/)
  server: { port: 3000, strictPort: true },
});
