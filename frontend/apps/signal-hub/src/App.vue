<template>
  <div class="page">
    <header>
      <h1>Signal Hub 前端通讯演示</h1>
      <p>
        同域优先使用浏览器原生能力，跨域通过公共中继页隔离，实时通讯在 WebSocket/SSE 之上叠加本地桥接，确保网络抖动下仍能保持多端一致。
      </p>
      <p class="hint">最近一次网络抖动补偿耗时：{{ lastGap }} ms</p>
    </header>

    <LocalCommSection
      v-model:local-alert="newLocalAlert"
      v-model:broadcast-alert="newBroadcastAlert"
      :local-cache="localCache.state"
      :broadcast-history="broadcastHistory"
      @push-local="pushLocal"
      @emit-broadcast="emitBroadcast"
    />

    <IframeBridgeSection
      :bridge-log="bridgeLog"
      :storage-snapshot="latestBridgeSnapshot"
      @replay="replayIframe"
      @broadcast="broadcastViaBridge"
    />

    <BackendCommSection
      :poll-snapshot="pollSnapshot"
      :polling-enabled="pollingEnabled"
      :sse-events="sseEvents"
      :ws-status="wsStatus"
      v-model:new-ws-message="newWsMessage"
      @toggle-polling="togglePolling"
      @reconnect-sse="reconnectSse"
      @send-ws="sendWs"
    />

    <MixedFlowSection :mixed-flow-log="mixedFlowLog" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { httpPoll, useBroadcastChannel, useLocalStorageObserver, useLocalStorageSync } from '@packages/local-comm';
import { createWsClient } from '@packages/ws-client';
import { BRIDGE_SNAPSHOT_EVENT, IframeBridge, type BridgeMessage } from '@packages/bridge-sdk';
import { useMessageStore } from './stores/messageStore';
import BackendCommSection from './components/BackendCommSection.vue';
import IframeBridgeSection from './components/IframeBridgeSection.vue';
import LocalCommSection from './components/LocalCommSection.vue';
import MixedFlowSection from './components/MixedFlowSection.vue';

// Signal Hub 页面：串联本地缓存、跨域桥、SSE、WebSocket、HTTP Poll 的示例状态。
const messageStore = useMessageStore();

const localCache = useLocalStorageSync<string[]>(
  'signal-hub.local.alerts',
  [],
  {
    onRemoteUpdate(value) {
      messageStore.pushMessage({
        id: crypto.randomUUID(),
        body: `Storage Sync: ${value.at(-1)}`,
        channel: 'local',
        createdAt: Date.now(),
      });
    },
  }
);
const newLocalAlert = ref('');

const { history: broadcastHistory, post: broadcastPost } = useBroadcastChannel<string>(
  'signal-sync-alerts',
  'signal-hub',
  {
    onMessage(payload) {
      messageStore.pushMessage({
        id: crypto.randomUUID(),
        body: `Broadcast: ${payload}`,
        channel: 'broadcast',
        createdAt: Date.now(),
      });
    },
  }
);
const newBroadcastAlert = ref('');

// WebSocket 客户端，模拟需要向后端主动上传的数据链路。
const wsClient = createWsClient('ws://localhost:7001/ws/signal-hub?client=signal-hub', {
  heartbeatInterval: 8_000,
  reconnectDelay: 3_000,
  logger(message, payload) {
    console.debug('[WS]', message, payload);
  },
});
const wsStatus = computed(() => wsClient.status.value);
const newWsMessage = ref('');

const sseEvents = ref<string[]>([]);
let eventSource: EventSource | null = null;
let lastSseTs = Date.now();

const pollSnapshot = ref<string[]>([]);
const pollingEnabled = ref(false);
let pollTimer: number | null = null;

const BRIDGE_STORAGE_KEY = 'signal-bridge.snapshot';

const iframeBridge = new IframeBridge({
  bridgeUrl: 'http://localhost:4175/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['http://localhost:4173', 'http://localhost:4174', 'http://localhost:4175'],
  targetOrigin: 'http://localhost:4175',
  hmacSecret: 'demo-shared-secret',
  storageKey: BRIDGE_STORAGE_KEY,
});
const bridgeLog = ref<string[]>([]);
let disposeBridge: (() => void) | undefined;

// Vite HMR 会重新执行模块顶层代码，这里确保旧实例被销毁，避免重复 clientId 残留在中继页
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    iframeBridge.destroy();
  });
}

const { state: latestBridgeSnapshot } = useLocalStorageObserver<BridgeMessage<unknown> | null>(
  BRIDGE_STORAGE_KEY,
  null,
  {
    deserializer: (raw) => (raw ? (JSON.parse(raw) as BridgeMessage<unknown>) : null),
    customEvent: BRIDGE_SNAPSHOT_EVENT,
  }
);

const mixedFlowLog = ref<string[]>([]);

const lastGap = computed(() => messageStore.lastNetworkGapMs);

function pushLocal() {
  // 写入 localStorage，触发 storage 事件，从而模拟同域缓存同步。
  if (!newLocalAlert.value) return;
  localCache.write([...localCache.state.value, `${Date.now()}: ${newLocalAlert.value}`]);
  newLocalAlert.value = '';
}

function emitBroadcast() {
  // BroadcastChannel 负责同域标签页之间的快速同步。
  if (!newBroadcastAlert.value) return;
  broadcastPost(`[SignalHub] ${newBroadcastAlert.value}`);
  newBroadcastAlert.value = '';
}

function sendWs() {
  // 通过 WS 将策略/命令上传后端，再由后端 fan-out。
  if (!newWsMessage.value) return;
  wsClient.send({
    type: 'signal-hub-alert',
    body: newWsMessage.value,
    ts: Date.now(),
  });
  newWsMessage.value = '';
}

function reconnectSse() {
  teardownSse();
  startSse();
}

// 手动触发 iframe 桥发送消息，模拟用户操作。
function replayIframe(message: string) {
  iframeBridge.send('signal-hub-alert', {
    body: message,
  }, (message) => {
    console.log('Iframe bridge sent:', message);
    bridgeLog.value = [`${new Date().toISOString()} ${message.type}`, ...bridgeLog.value].slice(0, 6);
  });
}

// 通过 iframe 桥将事件广播给所有标签页。
function broadcastViaBridge() {
  const latest = sseEvents.value[0];
  if (!latest) return;
  iframeBridge.send('sse-mirror', { body: latest }, (message) => {
    console.log('Iframe bridge sent:', message);
    bridgeLog.value = [`${new Date().toISOString()} ${message.type}`, ...bridgeLog.value].slice(0, 6);
  });
}

function recordMixedFlow(step: string) {
  mixedFlowLog.value = [`${new Date().toISOString()} ${step}`, ...mixedFlowLog.value].slice(0, 6);
}

const startSse = () => {
  // Signal Hub 作为“官方来源”，通过 SSE 接收后端消息。
  recordMixedFlow('SSE connecting...');
  eventSource = new EventSource('http://localhost:7001/api/sse/stream', {
    withCredentials: true,
  });
  eventSource.onmessage = (event) => {
    lastSseTs = Date.now();
    const payload = `SSE >> ${event.data}`;
    sseEvents.value = [payload, ...sseEvents.value].slice(0, 10);
    messageStore.pushMessage({
      id: crypto.randomUUID(),
      channel: 'sse',
      body: payload,
      createdAt: Date.now(),
    });
    iframeBridge.send('sse-fanout', { body: event.data });
    recordMixedFlow('SSE delivered + iframe fan-out');
  };
  eventSource.onerror = () => {
    // 记录抖动时间差并提示 fallback。
    const gap = Date.now() - lastSseTs;
    messageStore.trackNetworkGap(gap);
    recordMixedFlow('SSE offline, fallback to HTTP polling');
  };
};

const teardownSse = () => {
  eventSource?.close();
  eventSource = null;
};

const startPolling = () => {
  // HTTP Poll 在 SSE 断线时兜底，周期性抓取最近消息。
  if (pollTimer) return;
  pollTimer = window.setInterval(async () => {
    try {
      const messages = await httpPoll<string[]>('http://localhost:7001/api/sse/messages?limit=3');
      pollSnapshot.value = messages;
    } catch (error) {
      console.warn('Polling failed', error);
    }
  }, 5_000);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

const togglePolling = () => {
  if (pollingEnabled.value) {
    pollingEnabled.value = false;
    stopPolling();
    return;
  }
  pollingEnabled.value = true;
  startPolling();
};

onMounted(async () => {
  wsClient.connect();
  startSse();
  await iframeBridge.init();
  /**
   * bridge.onMessage 监听 IframeBridge 统一出口的消息
   * 这些消息可能来源于 iframe 的 postMessage，也可能来源于 BroadcastChannel
   * 但不包括所有原始 iframe / BroadcastChannel 消息。
   * 在这里处理这些消息，方便观察桥接效果。
   */
  disposeBridge = iframeBridge.onMessage((message) => {
    bridgeLog.value = [`${message.type}: ${JSON.stringify(message.payload)}`, ...bridgeLog.value].slice(0, 8);
    messageStore.pushMessage({
      id: message.id,
      channel: 'iframe',
      body: `${message.type}: ${JSON.stringify(message.payload)}`,
      createdAt: message.timestamp,
    });
  });
  recordMixedFlow('iframe ready, bridging SSE + BroadcastChannel');
});

onBeforeUnmount(() => {
  stopPolling();
  teardownSse();
  disposeBridge?.();
  wsClient.close();
});
</script>

<style scoped>
:global(:root) {
  --sh-bg: #edf2ff;
  --sh-card: #ffffff;
  --sh-border: #d8e1ff;
  --sh-text: #0f172a;
  --sh-muted: #64748b;
  --sh-primary: #2563eb;
  --sh-primary-dark: #1d4ed8;
  --sh-shadow: 0 10px 25px rgba(15, 23, 42, 0.1);
  --sh-radius: 14px;
}

:global(body) {
  margin: 0;
  background: radial-gradient(circle at top, rgba(37, 99, 235, 0.08), transparent 45%), var(--sh-bg);
  min-height: 100vh;
  font-family: 'SF Pro', 'Microsoft Yahei', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--sh-text);
}

:global(button) {
  cursor: pointer;
  border-radius: 12px;
  padding: 10px 18px;
  font-weight: 600;
  border: 1px solid transparent;
  background: linear-gradient(135deg, var(--sh-primary), var(--sh-primary-dark));
  color: #fff;
  transition: transform 0.18s ease, filter 0.18s ease;
}

:global(button:hover) {
  transform: translateY(-2px);
  filter: brightness(1.05);
}

:global(textarea) {
  width: calc(100% - 32px);
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: rgba(248, 250, 252, 0.9);
  min-height: 110px;
  font-size: 14px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  position: relative;
  z-index: 1;
}

:global(textarea:focus) {
  outline: none;
  border-color: var(--sh-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}

header {
  background: var(--sh-card);
  border-radius: var(--sh-radius);
  padding: 24px;
  box-shadow: var(--sh-shadow);
  margin-bottom: 32px;
  border: 1px solid var(--sh-border);
}

header h1 {
  margin: 0 0 12px;
  font-size: 28px;
}

header p {
  margin: 6px 0;
  color: var(--sh-muted);
  line-height: 1.5;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
}

section {
  margin-bottom: 32px;
  background: var(--sh-card);
  border-radius: var(--sh-radius);
  padding: 20px;
  border: 1px solid var(--sh-border);
  box-shadow: var(--sh-shadow);
}

section h2 {
  margin-top: 0;
  margin-bottom: 12px;
}

article,
textarea,
pre {
  border: 1px solid var(--sh-border);
  border-radius: 10px;
  padding: 12px;
  background: #f8fafc;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
}

article h3 {
  margin-top: 0;
}

textarea {
  min-height: 96px;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
}

pre {
  max-height: 200px;
  overflow: auto;
  font-size: 13px;
  background: #0f172a;
  color: #e2e8f0;
}

.hint {
  color: #059669;
  font-weight: 600;
}

@media (max-width: 640px) {
  .page {
    padding: 24px 16px;
  }

  section {
    padding: 18px;
  }
}
</style>
