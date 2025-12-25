import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const appRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '../..');
const packageAliases = ['local-comm', 'ws-client', 'bridge-sdk'].reduce<Record<string, string>>((aliases, pkg) => {
  aliases[`@packages/${pkg}`] = path.resolve(workspaceRoot, `packages/${pkg}/src`);
  return aliases;
}, {});

// 公共中继页独立运行在 4175 端口，构建产物也单独输出。

export default defineConfig({
  root: appRoot,
  plugins: [vue()],
  server: {
    port: 4175,
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
    outDir: path.resolve(workspaceRoot, 'dist/comms-bridge'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(appRoot, 'index.html'),
    },
  },
});
