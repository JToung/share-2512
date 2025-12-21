# 前端通讯方案说明

> 主题：同域优先浏览器原生能力 + 跨域公共中继页 + WebSocket/SSE 增强

```
frontend/
├─ apps/
│  ├─ risk-app/        # 生产侧风控应用，演示全部通讯策略
│  ├─ audit-app/       # 审计端消费，演示桥接回放
│  └─ comms-bridge/    # comms.xxx.com 中继页，实现 postMessage + BroadcastChannel
└─ packages/
   ├─ bridge-sdk/      # IframeBridge 安全 & 生命周期封装
   ├─ local-comm/      # localStorage + BroadcastChannel 组合
   └─ ws-client/       # 带心跳的 WebSocket 客户端
```

## 核心示例

| 场景 | 文件 | 说明 |
| --- | --- | --- |
| localStorage / storage | `apps/risk-app/src/App.vue` | `useLocalStorageSync` 自动写入 + storage 事件回流 |
| BroadcastChannel | `packages/local-comm/src/index.ts` | `useBroadcastChannel` 提供 history + onMessage |
| IframeBridge | `packages/bridge-sdk/src/index.ts` | origin 白名单、targetOrigin、HMAC、防重放、beforeunload 清理 |
| 公共中继页 | `apps/comms-bridge/src/main.ts` | 中继页验证签名，二次广播到 BroadcastChannel |
| SSE | `apps/risk-app/src/App.vue` & `apps/audit-app/src/App.vue` | EventSource 监听 + fallback 到 HTTP Poll |
| WebSocket | `packages/ws-client/src/index.ts` | 心跳、自动重连、send 包装 |
| 混合增强 | `apps/risk-app/src/App.vue` | SSE 到达 -> iframeBridge -> BroadcastChannel -> audit |

## Pinia + 业务示例

`apps/risk-app/src/stores/messageStore.ts` 维护统一消息流，`App.vue` 中对 all channels 的消息统一落盘并在网络抖动时记录 `lastNetworkGapMs`。

## 运行思路

1. 将 comms-bridge 部署为独立域（`comms.xxx.com`），并在宿主页面以 sandbox iframe 懒加载。
2. 风控端（`risk-app`）SSE 获取后端推送，再通过 `IframeBridge` + `BroadcastChannel` 广播给审计端。
3. 审计端（`audit-app`）监听桥接消息，同时独立消费 SSE 以验证桥接质量。
4. 当 SSE 断开后，`risk-app` 自动退化到 `httpPoll`，并继续通过 iframe 通知审计端。

## 项目运行

```bash
# 前端
cd frontend
pnpm install
pnpm run dev:risk   # http://localhost:4173
pnpm run dev:audit  # http://localhost:4174
pnpm run dev:comms  # http://localhost:4175

# 后端（在 backend/ 下）
pnpm install
pnpm run dev        # MidwayJS + MongoDB，默认端口 7001
```

> 提示：三个 Vite 应用共用 `packages/*`，如需生产构建可执行 `pnpm run build:risk|audit|comms`；若要一次性检查类型，使用 `pnpm run typecheck`。

## 关键代码片段

```ts
// localStorage + storage 事件双向同步
const cache = useLocalStorageSync('risk.local.alerts', [], {
  onRemoteUpdate(value) {
    console.info('storage updated', value);
  },
});

// BroadcastChannel reactive 封装
const { history, post } = useBroadcastChannel('risk-alerts', 'risk-app', {
  onMessage(payload) {
    console.log('channel payload', payload);
  },
});

// iframeBridge 懒加载 + HMAC 校验
const bridge = new IframeBridge({
  bridgeUrl: 'https://comms.xxx.com/index.html',
  channelName: 'risk-audit-sync',
  allowedOrigins: ['https://risk.xxx.com', 'https://audit.xxx.com', 'https://comms.xxx.com'],
  targetOrigin: 'https://comms.xxx.com',
  hmacSecret: 'demo-shared-secret',
});
await bridge.init();
bridge.onMessage((message) => console.log('bridge', message));

// WebSocket 自动重连 + 心跳
const client = createWsClient('ws://localhost:7001/ws/risk', {
  reconnectDelay: 3_000,
  heartbeatInterval: 8_000,
});
client.connect();
```

## 何时采用哪种方案

| 目标 | 推荐方案 | 备注 |
| --- | --- | --- |
| 同域标签页同步 | localStorage + `storage` 事件 / BroadcastChannel | 纯浏览器能力，零依赖 |
| 跨域 / 跨平台消费后端消息 | SSE + 公共中继页 | SSE 天生单向 push，断线可自动恢复 |
| 向后端实时写入 | WebSocket | 我们的 `ws-client` 自带心跳与重连 |
| 网络抖动 + 多域同步 | SSE/WebSocket + 公共 iframe + BroadcastChannel | 中继页可缓存 + 本地回放，避免后端重复推送 |

## 学习要点

- 原生 API 足以支撑大部分同域需求。
- 跨域通讯应该通过最小化暴露面的公共中继页（`comms.xxx.com`）实现安全隔离。
- 实时方案必须考虑断网后的补偿：HTTP Poll + iframe 二次广播。
- 所有消息使用统一结构：`{ id, type, payload, timestamp, nonce, signature }`。
