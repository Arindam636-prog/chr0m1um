import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../demo',
    emptyOutDir: false,
    assetsDir: 'assets/judge',
    rollupOptions: {
      input: { main: 'index.html', railway: 'railway.html' },
      output: {
        assetFileNames: 'assets/judge/[name]-[hash][extname]',
        chunkFileNames: 'assets/judge/[name]-[hash].js',
        entryFileNames: 'assets/judge/[name]-[hash].js'
      }
    }
  }
});
