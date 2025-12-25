# 前端通讯方案对比与增强案例

面向前端 / 全栈分享的演示仓库：以 **Vue 3 + TypeScript + Pinia** 前端与 **MidwayJS + MongoDB** 后端为基础，完整实现浏览器本地通讯、跨域 iframe 中继页、SSE / WebSocket 实时链路与网络抖动下的混合补偿策略。

## 仓库亮点

- **三款 Vite 应用**（Signal Hub、Signal Viewer、Comms Bridge）分别承担通信源、观测面板与跨域桥梁三种角色，可单独部署。
- **IframeBridge + BroadcastChannel 双通道**：桥页只对已握手的白名单 origin 开放，所有消息强制执行 timestamp + nonce + HMAC 验证，杜绝回环与伪造。
- **localStorage + BroadcastChannel 组合 Hook**：`useLocalStorageSync / useLocalStorageObserver / useBroadcastChannel / httpPoll` 等封装直接复用。
- **MidwayJS 实时后台**：`SSE + HTTP Poll + WebSocket` 统一落在 `MessageService`，所有消息入库后可回放/审计。
- **网络抖动增强**：SSE 断链时自动退化到 HTTP Poll，再通过 iframeBridge + BroadcastChannel 把最新快照回灌给多端页面。

## 目录结构

```
frontend/
  apps/
    signal-hub/          # 主业务站（全链路演示 + Pinia 状态）
    signal-viewer/       # 观测面板（被动消费 + 回放校验）
    comms-bridge/        # comms.xxx.com 中继页（postMessage -> BroadcastChannel）
  packages/
    bridge-sdk/          # IframeBridge（握手、HMAC、lazy iframe、快照）
    local-comm/          # localStorage + BroadcastChannel + HTTP Poll Hook
    ws-client/           # 心跳 + 自动重连的 WebSocket 客户端
backend/
  src/controller/        # SSE & HTTP API / WS HTTP 入口
  src/websocket/         # @midwayjs/ws 网关
  src/service/           # MongoDB MessageService
  src/entity/            # Message schema
  src/config/            # Midway 配置
```

## 快速体验

### 前端（Vite + pnpm 工作空间）

```bash
cd frontend
pnpm install
pnpm dev:signal-hub    # http://localhost:4173
pnpm dev:signal-viewer # http://localhost:4174
pnpm dev:comms         # http://localhost:4175 (iframe 中继页)
```

> 三个应用共享 `packages/*`，如需一次性构建可执行 `pnpm run build:signal-hub|signal-viewer|comms`，检查类型用 `pnpm run typecheck`。

### 后端（MidwayJS + MongoDB）

```bash
cd backend
pnpm install
pnpm dev   # 默认监听 7001
```

确保本地 MongoDB 可用（示例连接 `mongodb://localhost:27017/share2512`）。`http://localhost:7001` 供前端 SSE/WebSocket/HTTP Poll 使用。

## 前端应用速览

| 模块 | 定位 | 关键点 |
| --- | --- | --- |
| `apps/signal-hub` | 通讯中枢 / 生产者 | 同时演示 localStorage、BroadcastChannel、IframeBridge、SSE、WebSocket、HTTP Poll，`MixedFlowSection` 记录补偿链路。 |
| `apps/signal-viewer` | 消费端 / 大屏 | 通过 iframeBridge 接入 `comms.xxx.com`，并直接消费 SSE + WebSocket + BroadcastChannel，验证多源一致性。 |
| `apps/comms-bridge` | 独立域中继页 | 唯一拥有 BroadcastChannel 的页面：握手前置、origin 白名单、HMAC 校验、nonce 防重放、`clients` 生命周期管理。 |

## 通用 Packages

| 包 | 说明 |
| --- | --- |
| `packages/bridge-sdk` | `IframeBridge` 负责懒加载 sandbox iframe、握手(`bridge:hello/ack`)、postMessage + BroadcastChannel 双发、HMAC/nonce 校验与 localStorage 快照。 |
| `packages/local-comm` | `useLocalStorageSync`、`useLocalStorageObserver`、`useBroadcastChannel`、`httpPoll` 等 Vue 组合式 API，封装 history/onMessage 与 storage 事件。 |
| `packages/ws-client` | `createWsClient` 提供 `status` 响应式状态、自动重连、心跳发送、统一日志，方便在组件中直接引用。 |

## 后端能力

1. **SSE 流**（`backend/src/controller/sse.controller.ts`）  
   - `GET /api/sse/stream` 建立长连接，`broadcast()` fan-out。  
   - `POST /api/sse/message` 入库后推送，`GET /api/sse/messages` 提供 HTTP Poll 补偿。  
   - 自带 Origin 白名单 + CORS 自适应策略。
2. **WebSocket 网关**（`backend/src/websocket/gateway.ts` + `controller/ws.controller.ts`）  
   - `@OnWSConnection` 根据 `?client=` 注册来源，`WsClientRegistry` 统一管理在线连接。  
   - `@OnWSMessage` 解析消息并广播；也可通过 `POST /api/ws/message` 用 HTTP 注入指令。  
3. **消息服务**（`backend/src/service/message.service.ts` + `entity/Message.ts`）  
   - 统一记录 `type/channel/direction/payload`，支撑 SSE/WS/HTTP 回放，提供 `recent()`、`cleanupBefore()` 等方法。

## 架构拓扑

```
┌──────────────┐        HTTP Poll           ┌───────────────┐
│ signal-hub.xxx.com ─────/api/messages───▶ │ Midway + Mongo│
│ (Vue + Pinia)│                            │   (SSE + WS)  │
│  localStorage│◀────────SSE stream────────▶│               │
│  Broadcast   │                            │               │
│  useWSClient │──────WebSocket────────────▶│               │
└──────┬───────┘                            └───────┬───────┘
       │ postMessage + BC                           │
       ▼                                            │
┌───────────────┐    BroadcastChannel   ┌───────────┴───────────┐
│comms.xxx.com  │◀─────────────────────▶│ signal-viewer.xxx.com │
│ sandbox iframe│     replay cache      │   (Vue EventSource)   │
│ HMAC verify   │──────────────────────▶│  useBroadcastChannel  │
└───────────────┘                       └───────────────────────┘
```

## 通信链路要点

- Signal Hub 通过 SSE 获取后端推送，一旦收到就立刻调用 `IframeBridge.send()`，中继页再 fan-out 到 BroadcastChannel，确保本地所有标签页同步。
- SSE 断线由 `messageStore.trackNetworkGap()` 记录时间差，并打开 `httpPoll` 兜底；轮询得到的快照仍会通过 iframeBridge 广播。
- WebSocket 负责前端 → 后端的主动指令，上行同时写入 MongoDB，方便审计。
- Signal Viewer 同时监听 iframeBridge、SSE、BroadcastChannel、localStorage snapshot，对比不同路径的延迟与可用性。
- 中继页是唯一的 BroadcastChannel 使用者，Client 永远无法直接广播，彻底消除 a→b→c 级联。

## 推荐策略对照表

| 场景 | 推荐方案 | 理由 |
| --- | --- | --- |
| 同平台 / 同域 | `localStorage + storage` / `BroadcastChannel` | 浏览器原生能力，零部署成本 |
| 跨平台接收后端消息 | SSE | 单向推送、断线自动恢复，节省连接资源 |
| 跨平台向后端发送消息 | WebSocket | 真正的双向链路，可附带心跳与 QoS |
| 网络抖动 + 多域页面 | 公共 iframe（`comms.xxx.com`）+ `postMessage` + `BroadcastChannel` | 通过本地桥完成快速补偿 & 消息回放 |

## 核心文件速递

- `frontend/packages/local-comm/src/index.ts`：`useLocalStorageSync`、`useBroadcastChannel`、`useLocalStorageObserver`、`httpPoll`。
- `frontend/packages/bridge-sdk/src/index.ts`：IframeBridge 封装（origin 白名单 + targetOrigin + HMAC + nonce + 快照事件）。
- `frontend/packages/ws-client/src/index.ts`：`createWsClient` 心跳、重连、统一日志。
- `frontend/apps/comms-bridge/src/main.ts`：公共中继页；握手、origin 校验、HMAC 验证、BroadcastChannel fan-out、Client 生命周期管理。
- `frontend/apps/signal-hub/src/App.vue`：将 localStorage、BroadcastChannel、iframeBridge、SSE、WebSocket、HTTP Poll 串成单页体验。
- `frontend/apps/signal-viewer/src/App.vue`：消费 iframeBridge/SSE/WS 并对比延迟。
- `frontend/apps/signal-hub/src/stores/messageStore.ts`：统一记录多通道消息并跟踪网络抖动时间。
- `backend/src/controller/sse.controller.ts`：SSE Server + HTTP Poll + CORS 白名单。
- `backend/src/websocket/gateway.ts` / `controller/ws.controller.ts`：WS 双向网关 + HTTP 推送入口。
- `backend/src/service/message.service.ts`：消息入库、回放、清理。

## 关键代码片段

### localStorage + BroadcastChannel（`frontend/apps/signal-hub/src/App.vue`）

```ts
const cache = useLocalStorageSync('signal-hub.local.alerts', [], {
  onRemoteUpdate(value) {
    store.pushMessage({ id: crypto.randomUUID(), channel: 'local', body: String(value.at(-1)), createdAt: Date.now() })
  },
})

const { history, post } = useBroadcastChannel('signal-sync-alerts', 'signal-hub', {
  onMessage(payload) {
    store.pushMessage({ id: crypto.randomUUID(), channel: 'broadcast', body: String(payload), createdAt: Date.now() })
  },
})
```

### IframeBridge 安全策略（`frontend/packages/bridge-sdk/src/index.ts`）

```ts
const bridge = new IframeBridge({
  bridgeUrl: 'https://comms.xxx.com/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['https://signal-hub.xxx.com', 'https://signal-viewer.xxx.com', 'https://comms.xxx.com'],
  targetOrigin: 'https://comms.xxx.com',
  hmacSecret: 'demo-shared-secret',
  storageKey: 'signal-bridge.snapshot',
})
await bridge.init()
bridge.onMessage((msg) => console.log('bridge payload', msg))
```

### WebSocket 自动重连 + 心跳（`frontend/packages/ws-client/src/index.ts`）

```ts
const wsClient = createWsClient('ws://localhost:7001/ws/signal-hub?client=signal-hub', {
  heartbeatInterval: 8000,
  reconnectDelay: 3000,
  logger(message, payload) {
    console.debug('[WS]', message, payload)
  },
})
wsClient.connect()
wsClient.send({ type: 'signal-hub-alert', body: 'from browser' })
```

### SSE 推送（`backend/src/controller/sse.controller.ts`）

```ts
@Controller('/api/sse')
export class SseController {
  @Get('/stream')
  async stream(@Context() ctx) {
    ctx.set('Content-Type', 'text/event-stream')
    const id = randomUUID()
    this.clients.set(id, { id, ctx })
    ctx.req.on('close', () => this.clients.delete(id))
  }

  @Post('/message')
  async push(@Body() body: Record<string, unknown>) {
    const saved = await this.messageService.recordInbound('sse', body)
    this.broadcast('message', saved)
    return { ok: true }
  }
}
```

## 分享建议（讲稿大纲）

1. **背景**：多终端（主业务站、观测大屏、合作伙伴入口）对实时一致性的诉求持续升温。
2. **同域先用原生能力**：`localStorage/storage` + `BroadcastChannel` 可以构建“本地总线”，再配合 Pinia 存储。
3. **跨域必须有中继页**：`comms.xxx.com` 是最小可用面，iframe sandbox + origin 白名单 + HMAC + nonce，消除回环。
4. **实时通讯分工**：SSE 负责后端 → 前端单向广播，WebSocket 在需要回写时介入；所有消息统一进入 Mongo 留痕。
5. **抖动补偿**：SSE 掉线后自动退化 HTTP Poll，同时借助 iframeBridge + BroadcastChannel 完成本地回放。
6. **总结**：追求高可用 + 低复杂度——本地问题本地解决，跨域通过中继隔离，实时链路始终考虑安全与补偿策略。
