# 前端通讯方案对比与增强案例

资深前端 / 全栈视角的分享案例，覆盖 **Vue 3 + TypeScript** 前端与 **MidwayJS + MongoDB** 后端，实现浏览器本地、跨域中继、前后端实时通讯以及网络抖动下的混合增强策略。

## 目录结构

```
frontend/
  apps/
    signal-hub/            # Signal Hub（通讯中枢）主应用（Pinia 状态 + 全量示例）
    signal-viewer/            # Signal Viewer（观测面板）消费示例
    comms-bridge/      # comms.xxx.com 公共中继页
  packages/
    bridge-sdk/        # IframeBridge（origin 校验 + HMAC + sandbox）
    local-comm/        # useBroadcastChannel & useLocalStorageSync
    ws-client/         # WebSocket 自动重连 + 心跳
backend/
  src/controller/      # SSE + WebSocket HTTP 接口
  src/websocket/       # @midwayjs/ws 网关
  src/service/         # MongoDB MessageService
  src/entity/          # Message schema
  src/config/          # Midway 配置
```

## 架构图

```
┌──────────────┐        HTTP Poll        ┌──────────────┐
│ signal-hub.xxx.com ───────/api/messages──▶ │ Midway + Mongo│
│  (Vue + Pinia│                        │  (SSE + WS)  │
│  localStorage│◀────SSE stream────────▶│              │
│  Broadcast   │                        │              │
│  useWSClient │──WebSocket────────────▶│              │
└──────┬───────┘                        └──────┬───────┘
       │ postMessage + BC                      │
       ▼                                       │
┌──────────────┐  BroadcastChannel  ┌──────────┴────────┐
│comms.xxx.com │◀──────────────────▶│ signal-viewer.xxx.com    │
│ sandbox iframe│  replay cache      │ (Vue EventSource)│
│ HMAC verify  │────────────────────▶│ useBroadcastChannel│
└──────────────┘                     └──────────────────┘
```

## 结论速览

| 场景 | 推荐方案 | 理由 |
| --- | --- | --- |
| 同平台 / 同域 | `localStorage + storage` / `BroadcastChannel` | 浏览器原生能力，零部署成本 |
| 跨平台接收后端消息 | SSE | 单向推送、断线自动恢复，节省连接资源 |
| 跨平台向后端发送消息 | WebSocket | 真正的双向链路，可附带心跳与 QoS |
| 网络抖动 + 多域页面 | 公共 iframe（`comms.xxx.com`）+ `postMessage` + `BroadcastChannel` | 通过本地增强桥完成快速补偿 & 消息回放 |

## 核心文件速递

- `frontend/packages/local-comm/src/index.ts`：`useLocalStorageSync`、`useBroadcastChannel`、`httpPoll`。
- `frontend/packages/bridge-sdk/src/index.ts`：IframeBridge 封装，包含 **origin 白名单**、**targetOrigin**、**HMAC + timestamp**、**nonce 防重放**、**懒加载 + beforeunload 清理**。
- `frontend/apps/comms-bridge/src/main.ts`：公共中继页实现，集中校验消息签名并向 `BroadcastChannel` 转发。
- `frontend/apps/signal-hub/src/App.vue`：演示 Vue 端如何串联 localStorage、BroadcastChannel、IframeBridge、SSE、WebSocket、HTTP Polling。
- `frontend/apps/signal-viewer/src/App.vue`：Signal Viewer 订阅 iframe & SSE，验证跨域传输。
- `backend/src/controller/sse.controller.ts`：SSE Server + 消息广播 + HTTP 轮询接口。
- `backend/src/websocket/gateway.ts`：`@midwayjs/ws` WebSocket 网关，双向处理消息并写入 MongoDB。

## 代码摘录

### Vue + Pinia + 本地通讯

```ts
const cache = useLocalStorageSync('signal-hub.local.alerts', []);
const { history, post } = useBroadcastChannel('signal-sync-alerts', 'signal-hub', {
  onMessage(payload) {
    store.pushMessage({ id: crypto.randomUUID(), channel: 'broadcast', body: payload, createdAt: Date.now() });
  },
});
```

### IframeBridge 安全策略

```ts
const bridge = new IframeBridge({
  bridgeUrl: 'https://comms.xxx.com/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['https://signal-hub.xxx.com', 'https://signal-viewer.xxx.com', 'https://comms.xxx.com'],
  targetOrigin: 'https://comms.xxx.com',
  hmacSecret: 'demo-shared-secret',
  replayWindowMs: 15000,
});
await bridge.init();
bridge.onMessage((msg) => console.log(msg));
```

### WebSocket 自动重连 + 心跳

```ts
const wsClient = createWsClient('ws://localhost:7001/ws/signal-hub', {
  heartbeatInterval: 8000,
  reconnectDelay: 3000,
});
wsClient.connect();
wsClient.send({ type: 'signal-hub-alert', body: 'from browser' });
```

### SSE 推送

```ts
@Controller('/api/sse')
export class SseController {
  @Get('/stream')
  async stream(@Context() ctx) {
    ctx.set('Content-Type', 'text/event-stream');
    const id = randomUUID();
    this.clients.set(id, ctx);
    ctx.req.on('close', () => this.clients.delete(id));
  }
}
```

## 分享建议（讲稿大纲）

1. **背景**：多终端（主业务站点、观测大屏、移动入口、合作伙伴）对实时消息一致性的诉求不断升高。
2. **同域优先用浏览器原生能力**：`localStorage/storage` + `BroadcastChannel` 成本最低，结合 Pinia 即可构成“本地总线”。
3. **跨域必须有中继页**：`comms.xxx.com` 做最小可用面，iframe sandbox + origin 白名单 + HMAC 签名，彻底隔离业务域。
4. **实时通讯分工**：SSE 负责后端 → 前端单向广播，WebSocket 承担需要回写的链路；二者统一进入 MessageService/MongoDB 留痕。
5. **网络抖动的增强策略**：SSE 断开时自动回落到 HTTP Polling，同时通过 iframeBridge + BroadcastChannel 让本地多个应用瞬间同步最新快照。
6. **总结**：追求高可用 + 低复杂度，选择合适方案而非最强方案——本地问题本地解决，跨域通过中继隔离，实时链路考虑补偿与安全。
