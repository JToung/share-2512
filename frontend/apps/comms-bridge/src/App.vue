<template>
  <!-- ================= 页面容器 ================= -->
  <div class="page">
    <!-- ================= 顶部说明区域 ================= -->
    <header class="hero">
      <p class="eyebrow">Secure Bridge Monitor</p>
      <h1>Bridge Relay 中继页</h1>
      <p>
        负责接收来自 Signal Hub / Signal Viewer 的 postMessage，
        通过 timestamp + nonce + HMAC 校验，
        校验通过后写入 BroadcastChannel 统一 fan-out。
        下方监控面板用于实时观察消息流转情况。
      </p>
    </header>

    <!-- ================= 统计信息 ================= -->
    <section class="stats-grid">
      <article class="stat-card">
        <div class="stat-label">Inbound Messages（入站）</div>
        <div class="stat-value">{{ state.stats.receivedTotal }}</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">Outbound Messages（出站）</div>
        <div class="stat-value">{{ state.stats.sentTotal }}</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">Connected Clients（已连接 Client）</div>
        <div class="stat-value">{{ clientCount }}</div>
      </article>
    </section>

    <!-- ================= 日志面板 ================= -->
    <div class="log-grid">
      <section
        v-for="section in logSections"
        :key="section.id"
        class="log-panel"
      >
        <div class="panel-head">
          <h2>{{ section.title }}</h2>
          <span class="panel-pill">{{ section.pill }}</span>
        </div>
        <p class="section-note">{{ section.note }}</p>

        <ul class="log-list">
          <li
            v-for="entry in getLogs(section.direction)"
            :key="entry.key"
            :class="['log-item', { 'is-bridge-event': entry.highlight }]"
          >
            <div class="log-header">
              <span
                :class="[
                  'log-pill',
                  entry.direction === 'received' ? 'inbound' : 'outbound'
                ]"
              >
                {{ section.direction === 'received' ? 'Inbound' : 'Outbound' }}
              </span>
              <span class="log-type">{{ entry.message.type }}</span>
              <span class="log-id">{{ formatShort(entry.message.id) }}</span>
              <span class="log-time">{{ formatClock(entry.timestamp) }}</span>
            </div>

            <div v-if="entry.detail" class="log-detail">
              {{ entry.detail }}
            </div>

            <div class="log-meta">
              <span>source: {{ entry.message.sourceId || 'bridge' }}</span>
              <span>nonce: {{ formatShort(entry.message.nonce) }}</span>
              <span>
                signature: {{ formatShort(entry.message.signature, 12) }}
              </span>
            </div>

            <pre class="log-json">{{ entry.json }}</pre>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue';
import { BridgeMessage, ClientInfo, LogDirection, LogEntry } from './types';

// 允许接入 Bridge 的 origin 白名单
const allowedOrigins = new Set([
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
]);

// 同源 BroadcastChannel，用于 bridge → clients 的统一 fan-out
const broadcastChannel = new BroadcastChannel('signal-sync-bridge');
// 监控面板之间共享日志的通道
const logSyncChannel = new BroadcastChannel('signal-sync-bridge-ui-sync');
const tabId = crypto.randomUUID();

// 已完成握手的 Client 注册表
const clients = new Map<string, ClientInfo>();

// 已使用的 nonce 集合，用于防止重放攻击
const seenNonces = new Set<string>();

// HMAC 相关基础配置
const encoder = new TextEncoder();
const hmacSecret = 'demo-shared-secret';
const replayWindowMs = 15_000;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

/* ================= UI & 状态 ================= */

const logLimit = 80;
const clientCount = computed(() => new Set(state.logs.received.map(entry => entry.message.sourceId)).size);

const state = reactive({
  stats: {
    receivedTotal: 0,
    sentTotal: 0,
  },
  logs: {
    received: [] as LogEntry[],
    sent: [] as LogEntry[],
  },
});

const logSections = [
  {
    id: 'received',
    title: '接收到的消息',
    note: '所有进入 Bridge 的 postMessage。',
    pill: 'Inbound',
    direction: 'received' as LogDirection,
  },
  {
    id: 'sent',
    title: '发送出去的消息',
    note: 'bridge:ack 及 BroadcastChannel fan-out。',
    pill: 'Outbound',
    direction: 'sent' as LogDirection,
  },
];

/* ================= 工具函数 ================= */

/**
 * 根据方向返回对应日志列表
 */
const getLogs = (d: LogDirection) =>
  d === 'received' ? state.logs.received : state.logs.sent;

/**
 * 截断长字符串，用于 UI 展示
 */
function formatShort(value: string, visible = 6) {
  return value?.length > visible ? value.slice(0, visible) + '…' : value || '—';
}

/**
 * 格式化时间戳为可读时间
 */
function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

/**
 * 写入一条日志，同时维护最大日志数量与统计信息
 * - 可选是否广播到其他标签页
 * @param direction 日志方向
 * @param message 消息内容
 * @param detail 详情描述
 * @param options 选项配置
 * @param options.broadcast 是否广播到其他标签页，默认 true
 */
function appendLog(
  direction: LogDirection,
  message: BridgeMessage,
  detail: string,
  options: { broadcast?: boolean } = {}
) {
  const { broadcast = true } = options;
  // bridge:* 事件单独高亮，方便区分系统事件
  const entry: LogEntry = {
    key: crypto.randomUUID(),
    direction,
    message,
    detail,
    highlight: message.type.startsWith('bridge:'),
    timestamp: message.timestamp,
    json: JSON.stringify(message, null, 2),
  };

  const target =
    direction === 'received'
      ? state.logs.received
      : state.logs.sent;

  target.unshift(entry);
  if (target.length > logLimit) target.pop();

  direction === 'received'
    ? state.stats.receivedTotal++
    : state.stats.sentTotal++;

  if (broadcast) {
    logSyncChannel.postMessage({
      type: 'bridge:log-sync',
      source: tabId,
      payload: { direction, message, detail },
    });
  }
}

/* ================= 核心逻辑 ================= */

/**
 * 处理 Client 的 bridge:hello 握手请求
 * - 注册 clientId
 * - 记录 origin 与 window 引用
 * - 返回 bridge:ack
 */
async function handshake(event: MessageEvent<BridgeMessage>) {
  const { clientId } = (event.data.payload ?? {}) as { clientId?: string };
  if (!clientId) return;

  clients.set(clientId, {
    id: clientId,
    origin: event.origin,
    window: event.source as Window,
    lastSeen: Date.now(),
  });

  // bridge 自身发出的消息同样走完整签名流程
  const ack = await sign({
    type: 'bridge:ack',
    payload: { clientId },
    sourceId: 'bridge',
  });

  (event.source as Window).postMessage(ack, event.origin);
  appendLog('sent', ack, `bridge:ack → ${clientId}`);
}

/**
 * postMessage 的统一入口
 * - 校验来源
 * - 校验安全字段
 * - 分发到握手或广播逻辑
 */
async function handleIncomingMessage(event: MessageEvent<BridgeMessage>) {
  if (!allowedOrigins.has(event.origin)) return;

  const msg = event.data;

  // 任一安全校验失败，消息直接丢弃
  if (
    !verifyTimestamp(msg) ||
    !verifyNonce(msg) ||
    !(await verifySignature(msg))
  ) {
    return;
  }

  appendLog('received', msg, `from ${msg.sourceId}`);

  // 握手消息单独处理
  if (msg.type === 'bridge:hello') {
    await handshake(event);
    return;
  }

  // 业务消息进入 BroadcastChannel
  broadcastChannel.postMessage(msg);
}

/**
 * BroadcastChannel 消息监听
 * - 将消息 fan-out 到所有已注册 Client
 */
const broadcastListener = (event: MessageEvent) => {
  const msg = event.data as BridgeMessage;
  
  clients.forEach((client, id) => {
    // 跳过消息原发送方，避免自回环
    if (id !== msg.sourceId) {
      client.window.postMessage(msg, client.origin);
    }
  });

  // 不广播 fan-out 消息，避免循环同步
  appendLog('sent', msg, 'fan-out', { broadcast: false });
};

/**
 * 监听其他标签同步过来的日志，保持 UI 显示一致
 */
const logSyncListener = (
  event: MessageEvent<{
    type?: string;
    source?: string;
    payload?: {
      direction: LogDirection;
      message: BridgeMessage;
      detail: string;
    };
  }>
) => {
  const payload = event.data;
  if (!payload || payload.type !== 'bridge:log-sync') return;
  if (payload.source === tabId) return;
  if (!payload.payload) return;

  appendLog(
    payload.payload.direction,
    payload.payload.message,
    payload.payload.detail,
    { broadcast: false }
  );
};

/* ================= 安全校验 ================= */

/**
 * 校验时间戳是否在允许的重放窗口内
 */
function verifyTimestamp(msg: BridgeMessage) {
  return Math.abs(Date.now() - msg.timestamp) <= replayWindowMs;
}

/**
 * 校验 nonce 是否被使用过
 */
function verifyNonce(msg: BridgeMessage) {
  if (seenNonces.has(msg.nonce)) return false;
  seenNonces.add(msg.nonce);
  setTimeout(() => seenNonces.delete(msg.nonce), replayWindowMs);
  return true;
}

/**
 * 校验 HMAC 签名是否匹配
 */
async function verifySignature(msg: BridgeMessage) {
  const key = await getCryptoKey();
  const payload = encoder.encode(
    `${msg.type}|${msg.timestamp}|${msg.nonce}|${JSON.stringify(msg.payload)}`
  );

  const sig = Uint8Array.from(
    msg.signature.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []
  );

  return crypto.subtle.verify('HMAC', key, sig, payload);
}

/**
 * 为 Bridge 发出的消息生成完整签名
 */
async function sign(
  partial: Omit<BridgeMessage, 'id' | 'timestamp' | 'nonce' | 'signature'>
) {
  const msg: BridgeMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
    signature: '',
    ...partial,
  };

  const key = await getCryptoKey();
  const payload = encoder.encode(
    `${msg.type}|${msg.timestamp}|${msg.nonce}|${JSON.stringify(msg.payload)}`
  );

  const sig = await crypto.subtle.sign('HMAC', key, payload);
  msg.signature = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return msg;
}

/**
 * 延迟初始化并缓存 CryptoKey，避免重复 import
 */
function getCryptoKey() {
  if (!cryptoKeyPromise) {
    cryptoKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(hmacSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }
  return cryptoKeyPromise;
}

/* ================= 生命周期 ================= */

onMounted(() => {
  // 仅在 Bridge 页面存活时监听通信
  window.addEventListener('message', handleIncomingMessage);
  broadcastChannel.addEventListener('message', broadcastListener);
  logSyncChannel.addEventListener('message', logSyncListener);
});

onBeforeUnmount(() => {
  // 页面卸载时释放资源，避免内存泄漏
  window.removeEventListener('message', handleIncomingMessage);
  broadcastChannel.removeEventListener('message', broadcastListener);
  broadcastChannel.close();
  logSyncChannel.removeEventListener('message', logSyncListener);
  logSyncChannel.close();
  clients.clear();
});
</script>

<style scoped>
:global(:root) {
  font-family: 'SF Pro', 'Microsoft Yahei', sans-serif;
  background: #030712;
  color: #e2e8f0;
  --bridge-bg: radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.18), transparent 50%),
    radial-gradient(circle at 80% 0%, rgba(59, 130, 246, 0.18), transparent 45%), #030712;
  --bridge-panel: rgba(15, 23, 42, 0.9);
  --bridge-border: rgba(148, 163, 184, 0.25);
  --bridge-accent: #22d3ee;
  --bridge-muted: rgba(226, 232, 240, 0.7);
  --bridge-pill-inbound: rgba(248, 113, 113, 0.25);
  --bridge-pill-outbound: rgba(52, 211, 153, 0.2);
  --bridge-json-bg: rgba(2, 6, 23, 0.8);
}

:global(body) {
  margin: 0;
  min-height: 100vh;
  background: var(--bridge-bg);
}

.page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 32px 20px 48px;
  color: #f8fafc;
}

.hero {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(13, 148, 136, 0.25));
  border: 1px solid rgba(34, 211, 238, 0.2);
  border-radius: 20px;
  padding: 28px;
  box-shadow: 0 25px 65px rgba(2, 6, 23, 0.65);
  margin-bottom: 28px;
}

.hero h1 {
  margin: 0 0 8px;
  font-size: 28px;
}

.hero .eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.7);
  margin-bottom: 6px;
}

.hero p {
  margin: 6px 0;
  color: var(--bridge-muted);
  line-height: 1.5;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}

.stat-card {
  background: var(--bridge-panel);
  border-radius: 16px;
  padding: 18px;
  border: 1px solid var(--bridge-border);
  box-shadow: 0 16px 40px rgba(3, 7, 18, 0.55);
}

.stat-label {
  font-size: 13px;
  color: var(--bridge-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  margin: 6px 0 0;
  color: var(--bridge-accent);
}

.log-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 22px;
}

.log-panel {
  background: var(--bridge-panel);
  border-radius: 18px;
  padding: 20px;
  border: 1px solid var(--bridge-border);
  box-shadow: 0 18px 45px rgba(2, 6, 23, 0.5);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.panel-head h2 {
  margin: 0;
  font-size: 18px;
}

.panel-pill {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 4px 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  color: var(--bridge-muted);
}

.section-note {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--bridge-muted);
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  max-height: 520px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.log-item {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(94, 234, 212, 0.16);
  background: rgba(3, 7, 18, 0.55);
  margin-bottom: 12px;
}

.log-item:last-child {
  margin-bottom: 0;
}

.log-item.is-bridge-event {
  border-color: rgba(125, 211, 252, 0.45);
  background: rgba(8, 47, 73, 0.65);
}

.log-header {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.9);
}

.log-pill {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.log-pill.inbound {
  background: var(--bridge-pill-inbound);
  color: #fca5a5;
}

.log-pill.outbound {
  background: var(--bridge-pill-outbound);
  color: #6ee7b7;
}

.log-type {
  font-weight: 600;
  color: #f8fafc;
}

.log-id {
  color: var(--bridge-muted);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}

.log-time {
  margin-left: auto;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.65);
}

.log-detail {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.8);
}

.log-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.65);
}

.log-json {
  margin-top: 10px;
  background: var(--bridge-json-bg);
  border-radius: 10px;
  padding: 10px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  border: 1px solid rgba(30, 64, 175, 0.35);
}

@media (max-width: 640px) {
  .hero {
    padding: 22px;
  }

  .page {
    padding: 28px 16px 48px;
  }
}
</style>
