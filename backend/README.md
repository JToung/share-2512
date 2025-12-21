# MidwayJS + MongoDB 后端

## 目录

```
backend/
├─ src/controller/
│  ├─ sse.controller.ts     # SSE 流 + HTTP 推送入口
│  └─ ws.controller.ts      # HTTP -> WebSocket 广播
├─ src/websocket/gateway.ts # @midwayjs/ws 网关，双向通讯
├─ src/service/message.service.ts
├─ src/entity/Message.ts
└─ src/config/config.default.ts
```

## 功能概述

1. **SSE 推送**：`GET /api/sse/stream` 建立连接，`SseController.broadcast` 负责 fan-out。
2. **WebSocket 双向**：`WsGateway` 维护客户端集合，`@OnWSMessage` 记录消息并转发。
3. **MongoDB 持久化**：`MessageService` 使用 `@midwayjs/mongoose` 保存所有入站/出站消息。
4. **HTTP 轮询接口**：`MessageService.recent()` 可被前端 `httpPoll` 调用。

## 运行

```bash
cd backend
pnpm install
pnpm run dev
```

确保 MongoDB 在 `mongodb://localhost:27017/share2512` 运行。端口 `7001` 对应前端示例中的 `http://localhost:7001`。

## API 摘要

| API | 说明 |
| --- | --- |
| `GET /api/sse/stream` | 建立 SSE 流，用于 Signal Hub / Signal Viewer 订阅 |
| `POST /api/sse/message` | 将消息写入 Mongo 并推送到所有 SSE 客户端 |
| `GET /api/sse/broadcast/test` | 快速触发一次 SSE 推送 |
| `POST /api/ws/message` | 通过 HTTP 发布 WebSocket 消息（后端会转发给在线 WS 客户端） |
| `GET /api/messages?limit=3` | （示例）轮询接口，可根据需要在 controller 内实现 |

## 消息结构

所有 SSE、WebSocket、iframe 桥的消息统一为：

```ts
interface Envelope {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  nonce: string;
}
```

后端会额外记录 `channel` 与 `direction` 字段，用于审计和补发策略。
