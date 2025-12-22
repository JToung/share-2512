import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const appRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '../..');
const packageAliases = ['local-comm', 'ws-client', 'bridge-sdk'].reduce<Record<string, string>>((aliases, pkg) => {
  aliases[`@packages/${pkg}`] = path.resolve(workspaceRoot, `packages/${pkg}/src`);
  return aliases;
}, {});

// Signal Viewer 的 Vite 配置，端口与别名与 Signal Hub 错开，方便并行运行。

export default defineConfig({
  root: appRoot,
  plugins: [vue()],
  server: {
    port: 4174,
    fs: {
      allow: [workspaceRoot],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(appRoot, 'src'),
      ...packageAliases,
    },
  },
  build: {
    outDir: path.resolve(workspaceRoot, 'dist/signal-viewer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(appRoot, 'index.html'),
    },
  },
});
