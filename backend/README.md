# backend：MidwayJS + MongoDB 实时服务

`backend/` 提供 Signal Hub / Signal Viewer / Comms Bridge 所需的 SSE、WebSocket 与 HTTP 轮询接口，并统一将消息写入 MongoDB，便于调试与补偿。

## 目录结构

```
backend/
├─ src/controller/
│  ├─ sse.controller.ts      # SSE stream + HTTP Poll + 测试接口
│  └─ ws.controller.ts       # HTTP -> WebSocket 注入入口
├─ src/websocket/gateway.ts  # @midwayjs/ws 网关，负责管理在线客户端
├─ src/service/
│  ├─ message.service.ts     # Mongo 消息服务
│  └─ ws-client-registry.ts  # WS 连接注册表（多进程复用）
├─ src/entity/Message.ts     # 消息 Schema（direction/channel/payload）
├─ src/config/config.default.ts
└─ bootstrap.js / package.json / pnpm-lock.yaml
```

## 运行方式

```bash
cd backend
pnpm install
pnpm dev
```

- 默认监听 `http://localhost:7001`。  
- MongoDB 连接字符串：`mongodb://localhost:27017/share2512`（可在 `src/config/config.default.ts` 修改）。  
- SSE、WebSocket 与 HTTP 接口都启用 Origin 白名单：`http://localhost:4173/4174/4175/10000`，如需联调其他域需同步调整。

## 模块说明

| 模块 | 职责 | 关键点 |
| --- | --- | --- |
| `SseController` (`src/controller/sse.controller.ts`) | 暴露 `/api/sse/*` 接口 | - `GET /stream` 建立长连接；<br/>- `POST /message` 入库并广播；<br/>- `GET /messages` 供 HTTP Poll 补偿；<br/>- `broadcast()` 负责 fan-out，自动剔除断开连接。 |
| `WsGateway` (`src/websocket/gateway.ts`) | WebSocket 网关 | - `@OnWSConnection` 根据 `?client=` 标识来源并加入注册表；<br/>- `@OnWSMessage` 解析 payload 并调用 `broadcast()`；<br/>- 自动清理关闭的 socket。 |
| `WsController` (`src/controller/ws.controller.ts`) | HTTP → WS 注入 | - `POST /api/ws/message` 将 HTTP 请求转为 WebSocket 广播；<br/>- 复用 `MessageService` 落库。 |
| `MessageService` (`src/service/message.service.ts`) | MongoDB 存储与查询 | - `recordInbound` / `recordOutbound` 统一记录消息方向；<br/>- `recent()` 支持 `/api/sse/messages` 轮询；<br/>- `cleanupBefore()` 可编写定时任务清理历史数据。 |

## API 摘要

| Method / Path | 描述 |
| --- | --- |
| `GET /api/sse/stream` | 建立 SSE 流（需合法 Origin，支持多客户端） |
| `POST /api/sse/message` | 通过 SSE 渠道广播任意 payload，并写入 Mongo |
| `GET /api/sse/messages?limit=5` | 返回最近消息列表，供 HTTP Poll 使用 |
| `GET /api/sse/broadcast/test` | 快速触发一次 SSE 示例消息 |
| `POST /api/ws/message` | HTTP 注入 WebSocket 消息（后端会 fan-out 给所有在线客户端） |
| `WS /ws/signal-hub?client=<id>` | WebSocket 实时通道；`client` 参数用于区分前端角色 |

## 数据模型

`src/entity/Message.ts` 定义统一的消息结构：

```ts
interface Message {
  type: string
  direction: 'inbound' | 'outbound'
  payload: Record<string, unknown>
  channel: 'sse' | 'ws' | 'http' | 'broadcast'
  createdAt: Date
  updatedAt: Date
}
```

前端 iframeBridge 消息附带 `{ id, type, payload, timestamp, nonce, signature }`，后端在入库时补充 `channel` / `direction`。默认集合名为 `messages`。

## CORS / 安全

- `SseController.applyCors()` 根据请求头中的 `Origin` 判断是否允许访问，并返回同源的 `Access-Control-Allow-Origin`。  
- WebSocket 依赖浏览器建立连接，因此 Origin 限制在前端配置；服务端通过 querystring 中的 `client` 参数做业务识别。  
- 若要部署线上环境，建议：
  1. 将允许的 Origin 更新为生产域名。  
  2. 在 `WsGateway` 中增加鉴权（如 token / cookie 验证）。  
  3. 将 `hmacSecret` 与数据库连接串改为环境变量注入。

## 调试手册

1. 启动 `pnpm dev` 后，访问 `http://localhost:7001/api/sse/broadcast/test`，观察前端 SSE 面板是否收到 `sse:test`。  
2. 使用 `curl` 推送 WebSocket 注入：
   ```bash
   curl -X POST http://localhost:7001/api/ws/message \
     -H "Content-Type: application/json" \
     -d '{"type":"api-ws","body":"from curl"}'
   ```
   确认 Signal Hub / Signal Viewer WebSocket 日志出现对应事件。  
3. 打开 MongoDB，查看 `messages` 集合是否记录 `channel`、`direction`、`payload`。  
4. 需要重置数据时可调用 `MessageService.cleanupBefore(new Date(...))`（可写成 CLI/脚本）。

## 常见问题

- **为什么 SSE 需要手动刷新 headers？**  
  `ctx.res.flushHeaders?.()` 确保在 Node.js 环境中立刻发送响应头，否则浏览器可能等待缓冲导致迟迟不触发 `onmessage`。  
- **WebSocket 心跳由谁发？**  
  由前端 `packages/ws-client` 定时发送 `{ type: 'heartbeat' }`，后端在 `broadcast()` 中忽略该类型，避免日志噪音。  
- **HTTP Poll 使用什么接口？**  
  `GET /api/sse/messages?limit=<n>`，Signal Hub 在 SSE 断线后每 5 秒调用一次。
