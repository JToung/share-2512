# frontend：浏览器端通讯演示

`frontend/` 目录承载整套 Vite 应用与复用包，聚焦“同域 → 跨域 → 前后端”逐级增强的通讯策略。所有示例都可在不修改后端的情况下独立启动，方便演讲或调试。

## 目录结构

```
frontend/
├─ apps/
│  ├─ signal-hub/      # Signal Hub：全量生产端，串联所有通道
│  ├─ signal-viewer/   # Signal Viewer：消费端 / 大屏，用于观测链路质量
│  └─ comms-bridge/    # comms.xxx.com 公共中继页，postMessage → BroadcastChannel
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
| `apps/signal-hub` | `4173` | 生产端：收集用户输入、消费后端 SSE/WS，并通过 iframeBridge 广播给其他页面 | `src/App.vue`、`components/*`、`stores/messageStore.ts` |
| `apps/signal-viewer` | `4174` | 观测端：同时监听 iframeBridge、SSE、WebSocket、BroadcastChannel，以验证一致性 | `src/App.vue` |
| `apps/comms-bridge` | `4175` | 独立域的中继页：负责握手、HMAC 校验、BroadcastChannel fan-out，是跨域通信唯一入口 | `src/main.ts` |

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

## 关键通信流程

1. **本地缓存同步**（`apps/signal-hub/src/components/LocalCommSection.vue`）  
   - `useLocalStorageSync` 写入后触发 `storage` 事件。  
   - `useBroadcastChannel` 低延迟广播同域标签页。
2. **跨域公共中继**（`apps/comms-bridge/src/main.ts` + `packages/bridge-sdk/`）  
   - Client 首先发送 `bridge:hello`，中继页校验 origin 并登记 `ClientInfo`。  
   - 所有业务消息强制执行 `timestamp + nonce + HMAC` 校验，通过唯一的 BroadcastChannel fan-out。  
   - `IframeBridge` 自动懒加载 sandbox iframe，双写 postMessage + BroadcastChannel。
3. **后端实时通道**（`apps/signal-hub/src/components/BackendCommSection.vue`）  
   - SSE：`EventSource('http://localhost:7001/api/sse/stream')`，断线后记录 `lastNetworkGapMs` 并 fallback 到 `httpPoll`。  
   - WebSocket：`createWsClient('ws://localhost:7001/ws/signal-hub?client=xxx')`，自带心跳与自动重连。
4. **混合增强链路**（`apps/signal-hub/src/components/MixedFlowSection.vue`）  
   - SSE 到达 → iframeBridge 广播 → BroadcastChannel 写入 Signal Viewer → Viewer 再次与后端 SSE 对比，形成多路径回放。

## 代表性代码

```ts
// apps/signal-hub/src/App.vue
const localCache = useLocalStorageSync('signal-hub.local.alerts', [], { onRemoteUpdate: notifyLocal })
const { history, post } = useBroadcastChannel('signal-sync-alerts', 'signal-hub', { onMessage: notifyBroadcast })

const iframeBridge = new IframeBridge({
  bridgeUrl: 'http://localhost:4175/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['http://localhost:4173', 'http://localhost:4174', 'http://localhost:4175'],
  targetOrigin: 'http://localhost:4175',
  hmacSecret: 'demo-shared-secret',
  storageKey: 'signal-bridge.snapshot',
})
await iframeBridge.init()
iframeBridge.onMessage((message) => messageStore.pushMessage({...}))
```

```ts
// packages/ws-client/src/index.ts
const wsClient = createWsClient('ws://localhost:7001/ws/signal-hub?client=signal-viewer', {
  heartbeatInterval: 8_000,
  reconnectDelay: 3_000,
})
wsClient.connect()
```

## 联调建议

1. 先启动 `pnpm dev`（后端目录）或使用远程服务，保证 `http://localhost:7001` 可访问。  
2. 启动 `signal-hub` 与 `comms-bridge`，触发 SSE 测试接口（`GET /api/sse/broadcast/test`）观察界面更新。  
3. 再启动 `signal-viewer`，确认它能同步 iframe 消息、本地快照、SSE 与 WebSocket 事件。  
4. 切换网络或手动停止 SSE 服务，查看 `MixedFlow` 面板中的回退与补偿路径。

## FAQ

- **为什么 BroadcastChannel 只能在中继页使用？**  
  为避免 `a → b → c` 回流风暴，只有 `comms-bridge` 可以访问 BroadcastChannel，其余客户端必须通过 `IframeBridge` 上行。
- **是否可以替换 HMAC？**  
  Demo 直接使用 `demo-shared-secret`，生产环境应由后端签发并通过安全配置注入，同时可以接入更严格的密钥轮换策略。
- **如何部署？**  
  `signal-hub` 与 `signal-viewer` 可落在各自业务域；`comms-bridge` 建议使用独立二级域（如 `comms.xxx.com`），iframe 以 `sandbox="allow-scripts allow-same-origin"` 懒加载。
