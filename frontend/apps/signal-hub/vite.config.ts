import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const appRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '../..');
const packageAliases = ['local-comm', 'ws-client', 'bridge-sdk'].reduce<Record<string, string>>((aliases, pkg) => {
  aliases[`@packages/${pkg}`] = path.resolve(workspaceRoot, `packages/${pkg}/src`);
  return aliases;
}, {});

/**
 * Signal Hub 专属 Vite 配置：允许跨 package 引用，并指定 dev/build 端口。
 */
export default defineConfig({
  root: appRoot,
  plugins: [vue()],
  server: {
    port: 4173,
    fs: {
      allow: [workspaceRoot], // 允许访问 monorepo packages。
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(appRoot, 'src'),
      ...packageAliases,
    },
  },
  build: {
    outDir: path.resolve(workspaceRoot, 'dist/signal-hub'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(appRoot, 'index.html'),
    },
  },
});
