import { defineConfig } from 'vite';
import path from 'path';

const appRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  root: appRoot,
  server: {
    port: 4175,
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
    outDir: path.resolve(workspaceRoot, 'dist/comms-bridge'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(appRoot, 'index.html'),
    },
  },
});
