import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const appRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  root: appRoot,
  plugins: [vue()],
  server: {
    port: 4173,
    fs: {
      allow: [workspaceRoot],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(appRoot, 'src'),
      '@packages': path.resolve(workspaceRoot, 'packages'),
    },
  },
  build: {
    outDir: path.resolve(workspaceRoot, 'dist/risk-app'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(appRoot, 'index.html'),
    },
  },
});
