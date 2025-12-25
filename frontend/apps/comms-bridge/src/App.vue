<template>
  <div class="page">
    <header class="hero">
      <p class="eyebrow">Secure Bridge Monitor</p>
      <h1>Bridge Relay 中继页</h1>
      <p>
        负责接收来自 Signal Hub / Signal Viewer 的 postMessage，通过 timestamp + nonce + HMAC 校验，并在通过校验后写入
        BroadcastChannel 统一 fan-out。下面的监控面板会实时展示完整的消息 Envelope，方便排查握手与广播链路。
      </p>
    </header>

    <section class="stats-grid">
      <article class="stat-card">
        <div class="stat-label">Inbound Messages（入站消息数）</div>
        <div class="stat-value">{{ state.stats.receivedTotal }}</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">Outbound Messages（出站消息数）</div>
        <div class="stat-value">{{ state.stats.sentTotal }}</div>
      </article>
      <article class="stat-card">
        <div class="stat-label">Active Clients（活跃 Client 数）</div>
        <div class="stat-value">{{ state.stats.clientCount }}</div>
      </article>
    </section>

    <div class="log-grid">
      <section v-for="section in logSections" :key="section.id" class="log-panel">
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
              <span :class="['log-pill', entry.direction === 'received' ? 'inbound' : 'outbound']">
                {{ section.direction === 'received' ? 'Inbound' : 'Outbound' }}
              </span>
              <span class="log-type">{{ entry.message.type }}</span>
              <span class="log-id">{{ formatShort(entry.message.id) }}</span>
              <span class="log-time">{{ formatClock(entry.timestamp) }}</span>
            </div>
            <div v-if="entry.detail" class="log-detail">{{ entry.detail }}</div>
            <div class="log-meta">
              <span>source: {{ entry.message.sourceId || 'bridge' }}</span>
              <span>nonce: {{ formatShort(entry.message.nonce) }}</span>
              <span>signature: {{ formatShort(entry.message.signature, 12) }}</span>
            </div>
            <pre class="log-json">{{ entry.json }}</pre>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue';

interface BridgeMessage<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  nonce: string;
  signature: string;
  sourceId: string;
}

interface ClientInfo {
  id: string;
  origin: string;
  window: Window;
  lastSeen: number;
}

type LogDirection = 'received' | 'sent';

interface LogEntry {
  key: string;
  direction: LogDirection;
  message: BridgeMessage;
  detail: string;
  highlight: boolean;
  timestamp: number;
  json: string;
}

const allowedOrigins = new Set([
  'https://signal-hub.xxx.com',
  'https://signal-viewer.xxx.com',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
]);

const broadcastChannel = new BroadcastChannel('signal-sync-bridge');
const clients = new Map<string, ClientInfo>();
const seenNonces = new Set<string>();
const encoder = new TextEncoder();
const hmacSecret = 'demo-shared-secret';
const replayWindowMs = 15_000;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

const logLimit = 80;
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour12: false,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const state = reactive({
  stats: {
    receivedTotal: 0,
    sentTotal: 0,
    clientCount: 0,
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
    note: '展示所有进入 Bridge 的 postMessage 请求（包含握手）。',
    pill: 'Inbound',
    direction: 'received' as LogDirection,
  },
  {
    id: 'sent',
    title: '发送出去的消息',
    note: '展示 Bridge 广播以及发出的 bridge:ack、BroadcastChannel fan-out。',
    pill: 'Outbound',
    direction: 'sent' as LogDirection,
  },
];

const getLogs = (direction: LogDirection) =>
  direction === 'received' ? state.logs.received : state.logs.sent;

function formatClock(timestamp: number) {
  return timeFormatter.format(timestamp);
}

function formatShort(value: string, visible = 6) {
  if (!value) return '—';
  return value.length <= visible ? value : `${value.slice(0, visible)}…`;
}

function formatMessage(message: BridgeMessage) {
  try {
    return JSON.stringify(message, null, 2);
  } catch {
    return '[message 无法序列化]';
  }
}

function appendLog(direction: LogDirection, message: BridgeMessage, detail: string) {
  const entry: LogEntry = {
    key: `${direction}-${message.id}-${message.nonce}-${crypto.randomUUID()}`,
    direction,
    message,
    detail,
    highlight: message.type.startsWith('bridge:'),
    timestamp: message.timestamp,
    json: formatMessage(message),
  };

  const target = direction === 'received' ? state.logs.received : state.logs.sent;
  target.unshift(entry);
  if (target.length > logLimit) {
    target.splice(logLimit);
  }

  if (direction === 'received') {
    state.stats.receivedTotal += 1;
  } else {
    state.stats.sentTotal += 1;
  }
}

function logReceivedMessage(message: BridgeMessage, detail: string) {
  appendLog('received', message, detail);
}

function logSentMessage(message: BridgeMessage, detail: string) {
  appendLog('sent', message, detail);
}

function updateClientCount() {
  state.stats.clientCount = clients.size;
}

async function handshake(event: MessageEvent<BridgeMessage>) {
  if (!event.source) return;

  const { clientId } = (event.data.payload ?? {}) as { clientId?: string };
  if (!clientId) {
    console.warn('❌ 握手失败：缺少 clientId');
    return;
  }

  const info: ClientInfo = {
    id: clientId,
    origin: event.origin,
    window: event.source as Window,
    lastSeen: Date.now(),
  };

  clients.set(clientId, info);
  updateClientCount();
  console.log('✅ Client 注册完成:', clientId);

  const ack = await sign({
    type: 'bridge:ack',
    payload: { clientId },
    sourceId: 'bridge',
  });

  info.window.postMessage(ack, info.origin);
  logSentMessage(ack, `bridge:ack → ${clientId} @ ${info.origin}`);
}

async function handleIncomingMessage(event: MessageEvent<BridgeMessage>) {
  if (!event.source || !allowedOrigins.has(event.origin)) {
    console.warn('❌ 拒绝非法来源:', event.origin);
    return;
  }

  const msg = event.data;

  if (
    !verifyTimestamp(msg) ||
    !verifyNonce(msg) ||
    !(await verifySignature(msg))
  ) {
    console.warn('❌ 消息安全校验失败:', msg);
    return;
  }

  const handshakePayload = (msg.payload ?? {}) as { clientId?: string };
  const detail =
    msg.type === 'bridge:hello'
      ? `握手请求 · clientId=${handshakePayload.clientId ?? '未知'} · origin=${event.origin}`
      : `来源 ${msg.sourceId} @ ${event.origin}`;
  logReceivedMessage(msg, detail);

  if (msg.type === 'bridge:hello') {
    await handshake(event);
    return;
  }

  const client = clients.get(msg.sourceId);
  if (!client || client.origin !== event.origin) {
    console.warn('❌ 未注册 Client 或 origin 不匹配:', msg.sourceId);
    return;
  }

  client.lastSeen = Date.now();
  broadcastChannel.postMessage(msg);
}

const broadcastListener = (event: MessageEvent) => {
  const msg = event.data as BridgeMessage;
  const recipients: string[] = [];

  clients.forEach((client, clientId) => {
    if (clientId === msg.sourceId) return;

    try {
      client.window.postMessage(msg, client.origin);
      recipients.push(`${clientId} @ ${client.origin}`);
    } catch {
      clients.delete(clientId);
      updateClientCount();
    }
  });

  const detail = recipients.length
    ? `fan-out → ${recipients.join(', ')}`
    : 'fan-out skipped（无可用 client）';
  logSentMessage(msg, detail);
};

function pruneClients() {
  const now = Date.now();
  let removed = false;
  for (const [id, client] of clients) {
    if (now - client.lastSeen > 60 * 60 * 1000) {
      clients.delete(id);
      removed = true;
    }
  }
  if (removed) updateClientCount();
}

function verifyTimestamp(msg: BridgeMessage) {
  return Math.abs(Date.now() - msg.timestamp) <= replayWindowMs;
}

function verifyNonce(msg: BridgeMessage) {
  if (seenNonces.has(msg.nonce)) return false;
  seenNonces.add(msg.nonce);
  setTimeout(() => seenNonces.delete(msg.nonce), replayWindowMs);
  return true;
}

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

const messageListener = (event: MessageEvent<BridgeMessage>) => {
  void handleIncomingMessage(event);
};

const beforeUnloadListener = () => {
  broadcastChannel.close();
  clients.clear();
  updateClientCount();
};

let pruneTimer: number | undefined;

onMounted(() => {
  window.addEventListener('message', messageListener);
  broadcastChannel.addEventListener('message', broadcastListener);
  window.addEventListener('beforeunload', beforeUnloadListener);
  pruneTimer = window.setInterval(pruneClients, 30_000);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', messageListener);
  broadcastChannel.removeEventListener('message', broadcastListener);
  window.removeEventListener('beforeunload', beforeUnloadListener);
  if (pruneTimer) window.clearInterval(pruneTimer);
  broadcastChannel.close();
  clients.clear();
});

updateClientCount();
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
