import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, 'ui', 'Panel.tsx'),
      formats: ['iife'],
      name: 'DsumPanel',
      fileName: () => 'panel.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => assetInfo.name === 'style.css' ? 'panel.css' : '[name][extname]',
      },
    },
  },
});
