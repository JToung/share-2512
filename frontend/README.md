# frontend：浏览器端通讯演示

`frontend/` 目录承载整套 Vite 应用与复用包，聚焦“同域 → 跨域 → 前后端”逐级增强的通讯策略。当前的演示界面刻意精简，只保留 localStorage + BroadcastChannel、IframeBridge 与 WebSocket 控制面，便于在分享时快速展示主干链路。

## 目录结构

```
frontend/
├─ apps/
│  ├─ signal-hub/      # Signal Hub：演示工作台
│  ├─ signal-viewer/   # Signal Viewer：订阅面板
│  └─ comms-bridge/    # comms.xxx.com 公共中继页
├─ packages/
│  ├─ bridge-sdk/      # IframeBridge 封装（握手、HMAC、防重放、快照）
│  ├─ local-comm/      # localStorage / BroadcastChannel / HTTP Poll 组合式 API
│  └─ ws-client/       # Vue 友好的 WebSocket 客户端（心跳 + 自动重连）
├─ package.json        # 工作空间入口
└─ pnpm-lock.yaml
```

## 应用角色

| 应用 | 端口（默认） | 作用 | 关键文件 |
| --- | --- | --- | --- |
| `apps/signal-hub` | `4173` | 浏览器端演示工作台，包含本地缓存同步、跨域 iframes 通讯、WebSocket 控制台三块区域 | `src/App.vue`、`components/*`、`stores/messageStore.ts` |
| `apps/signal-viewer` | `4174` | 观测端：订阅 iframeBridge 与 WebSocket，查看桥回放与在线状态 | `src/App.vue` |
| `apps/comms-bridge` | `4175` | 独立域的中继页：负责握手、HMAC 校验、BroadcastChannel fan-out，是跨域通信唯一入口 | `src/main.ts` |

## Signal Hub 页面组成

1. **LocalCommSection**（`components/LocalCommSection.vue`）：演示 `useLocalStorageSync` + `useBroadcastChannel` 的互补；同域标签页可以同步本地缓存与广播历史。
2. **IframeBridgeSection**（`components/IframeBridgeSection.vue`）：通过 `IframeBridge` 将输入内容发送到 `comms-bridge`，同时查看桥日志与 localStorage 快照，验证 origin / HMAC / nonce 策略。
3. **BackendCommSection**（`components/BackendCommSection.vue`）：聚焦 WebSocket 控制台，展示发送/接收日志与状态 pill；可以模拟前端主动推送策略。

> `MixedFlowSection` 与 SSE 相关逻辑仍保留在仓库，只是默认 UI 未挂载，需要扩展演示时可直接引入。

## Signal Viewer 面板

- 初始化与 Signal Hub 相同的 `IframeBridge`，持续监听桥发出的消息。
- 通过 `createWsClient('ws://localhost:7001/ws/signal-hub?client=signal-viewer')` 订阅 WebSocket，显示当前状态与下行日志。
- 适合作为“观测端”或大屏，实时对照 Signal Hub 操作。

## 通用 Packages

| 包 | 功能 | 常用导出 |
| --- | --- | --- |
| `packages/local-comm` | 封装浏览器原生 API，构建“本地总线” | `useLocalStorageSync`、`useLocalStorageObserver`、`useBroadcastChannel`、`httpPoll` |
| `packages/bridge-sdk` | 将 iframe + BroadcastChannel + HMAC 组合为可复用的 `IframeBridge` | `IframeBridge`、`BRIDGE_SNAPSHOT_EVENT`、`BridgeMessage` |
| `packages/ws-client` | 统一管理 WebSocket 状态、心跳与重连 | `createWsClient` |

## 开发命令

```bash
pnpm install                 # 根目录执行一次即可
pnpm dev:signal-hub          # http://localhost:4173
pnpm dev:signal-viewer       # http://localhost:4174
pnpm dev:comms               # http://localhost:4175

pnpm build:signal-hub        # 产物输出到 apps/signal-hub/dist
pnpm build:signal-viewer
pnpm build:comms

pnpm typecheck               # 一次性跑 tsc
```

> 三个应用共享 `packages/*`，若对包代码做改动，只需在任一应用中重新启动 dev server 或手动触发 HMR 即可。

## 联调建议

1. 启动后端 `pnpm dev`（`backend/`），确保 `http://localhost:7001`、WebSocket 与 Mongo 都可访问。  
2. 依次启动 `pnpm dev:comms`、`pnpm dev:signal-hub` 观察本地缓存、跨域桥日志与 WebSocket 状态。  
3. 根据需要再启动 `pnpm dev:signal-viewer`，验证它能同时收取 iframeBridge 与 WebSocket 消息。  
4. 通过 `signal-hub` 的按钮向桥发送消息，或在 WebSocket 面板输入内容，查看 Viewer 是否同步。  
5. 若需要演示 SSE / HTTP Poll，可调用 `GET /api/sse/broadcast/test`、`GET /api/sse/messages` 并在前端恢复相关组件。

## FAQ

- **为什么 BroadcastChannel 只能在中继页使用？**  
  为避免 `a → b → c` 回流风暴，只有 `comms-bridge` 可以访问 BroadcastChannel，其余客户端必须通过 `IframeBridge` 上行。
- **精简 UI 是否影响功能？**  
  否，SSE / HTTP Poll / MixedFlow 代码仍在仓库中，只是默认页面不再展示；需要演示时可直接解注或挂载组件。
- **如何部署？**  
  `signal-hub` 与 `signal-viewer` 可落在各自业务域；`comms-bridge` 建议使用独立二级域（如 `comms.xxx.com`），iframe 以 `sandbox="allow-scripts allow-same-origin"` 懒加载。
