<template>
  <div class="page">
    <h1>Signal Viewer 订阅中心</h1>
    <p>通过本地 http://localhost:4175 中继页接入 Signal Hub 实时消息，同时监听 BroadcastChannel 以防止 iframe 挂掉。</p>

    <section>
      <h2>IframeBridge 消息</h2>
      <button @click="requestSync">向中继页请求最新快照</button>
      <pre>{{ bridgeMessages }}</pre>
    </section>
    <section>
      <h2>WebSocket 下行</h2>
      <p class="ws-status">
        状态：
        <span class="status-pill" :class="wsStatusTone">{{ wsStatus }}</span>
      </p>
      <pre>{{ wsEventsText }}</pre>
    </section>
    <section>
      <h2>localStorage 快照（自动刷新）</h2>
      <p class="section-note">任一标签页触发 iframeBridge 消息后，这里会通过 storage 事件同步最新数据。</p>
      <pre>{{ storageSnapshotText }}</pre>
    </section>

    <section>
      <h2>BroadcastChannel 二次同步</h2>
      <pre>{{ channelHistory }}</pre>
    </section>

    <section>
      <h2>SSE（被动接收）</h2>
      <pre>{{ sseMirror }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useBroadcastChannel, useLocalStorageObserver } from '@packages/local-comm';
import { BRIDGE_SNAPSHOT_EVENT, IframeBridge, type BridgeMessage } from '@packages/bridge-sdk';
import { createWsClient } from '@packages/ws-client';

// Signal Viewer：专注于消费 Signal Hub + SSE 的观测面板。
const BRIDGE_STORAGE_KEY = 'signal-bridge.snapshot';
const iframeBridge = new IframeBridge({
  bridgeUrl: 'http://localhost:4175/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['http://localhost:4173', 'http://localhost:4174', 'http://localhost:4175'],
  targetOrigin: 'http://localhost:4175',
  hmacSecret: 'demo-shared-secret',
  storageKey: BRIDGE_STORAGE_KEY,
});
// Vite HMR 会重新执行模块顶层代码，这里确保旧实例被销毁，避免重复 clientId 残留在中继页
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    iframeBridge.destroy();
  });
}
const bridgeMessages = ref<string[]>([]);
let disposeBridge: (() => void) | undefined;
const { state: latestBridgeSnapshot } = useLocalStorageObserver<BridgeMessage<unknown> | null>(
  BRIDGE_STORAGE_KEY,
  null,
  {
    deserializer: (raw) => (raw ? (JSON.parse(raw) as BridgeMessage<unknown>) : null),
    customEvent: BRIDGE_SNAPSHOT_EVENT,
  }
);
const storageSnapshotText = computed(() => {
  const snapshot = latestBridgeSnapshot.value;
  if (!snapshot) return '暂无快照';
  try {
    return JSON.stringify(snapshot, null, 2);
  } catch {
    return String(snapshot);
  }
});

const { history: channelHistory } = useBroadcastChannel<Record<string, unknown>>('signal-sync-alerts', 'signal-viewer');

const sseMirror = ref<string[]>([]);
let eventSource: EventSource | null = null;
const wsEvents = ref<string[]>([]);
const wsClient = createWsClient('ws://localhost:7001/ws/signal-hub?client=signal-viewer', {
  logger(message, payload) {
    if (message === 'ws:message') {
      wsEvents.value = [`${new Date().toISOString()} ${payload}`, ...wsEvents.value].slice(0, 12);
    }
  },
});
const wsStatus = computed(() => wsClient.status.value);
const wsStatusTone = computed(() => {
  const status = (wsStatus.value ?? 'idle').toLowerCase();
  if (status.includes('open')) return 'tone-open';
  if (status.includes('connect')) return 'tone-wait';
  if (status.includes('error')) return 'tone-error';
  if (status.includes('closed')) return 'tone-closed';
  return 'tone-idle';
});
const wsEventsText = computed(() =>
  wsEvents.value.length ? wsEvents.value.join('\n') : '等待 WebSocket 消息...'
);

const requestSync = () => iframeBridge.send('signal-viewer-sync-request', { ts: Date.now() });

onMounted(async () => {
  // 初始化中继 iframe，并监听广播消息。
  await iframeBridge.init();
   /**
   * iframeBridge.onMessage 监听 IframeBridge 统一出口的消息
   * 这些消息可能来源于 iframe 的 postMessage，也可能来源于 BroadcastChannel
   * 但不包括所有原始 iframe / BroadcastChannel 消息。
   * 在这里处理这些消息，方便观察桥接效果。
   */
  disposeBridge = iframeBridge.onMessage((msg) => {
    bridgeMessages.value = [`${msg.type}: ${JSON.stringify(msg.payload)}`, ...bridgeMessages.value].slice(0, 10);
  });
  wsClient.connect();

  // Viewer 也会直接消费后端 SSE，方便对比桥接质量。
  eventSource = new EventSource('http://localhost:7001/api/sse/stream?consumer=signal-viewer', {
    withCredentials: true,
  });
  eventSource.onmessage = (event) => {
    sseMirror.value = [`SSE ${event.data}`, ...sseMirror.value].slice(0, 6);
  };
});

onBeforeUnmount(() => {
  disposeBridge?.();
  eventSource?.close();
  wsClient.close();
});
</script>

<style scoped>
:global(body) {
  background: radial-gradient(circle at 20% 20%, rgba(236, 127, 72, 0.12), transparent 45%), #fdf2f8;
  min-height: 100vh;
  margin: 0;
  font-family: 'SF Pro', 'Microsoft Yahei', sans-serif;
}

.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 20px 48px;
  color: #3b0b3f;
}

h1 {
  margin-bottom: 10px;
}

p {
  color: #af721c;
}

.section-note {
  margin: 4px 0 8px;
  color: #b45309;
  font-size: 14px;
}

.ws-status {
  margin: 6px 0 10px;
  color: #b45309;
  font-weight: 600;
}

.status-pill {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(190, 112, 24, 0.1);
  text-transform: uppercase;
  font-size: 12px;
  margin-left: 4px;
}

.status-pill.tone-open {
  background: rgba(16, 185, 129, 0.18);
  color: #0f766e;
}

.status-pill.tone-wait {
  background: rgba(251, 191, 36, 0.25);
  color: #92400e;
}

.status-pill.tone-error,
.status-pill.tone-closed {
  background: rgba(239, 68, 68, 0.18);
  color: #991b1b;
}

.status-pill.tone-idle {
  background: rgba(148, 163, 184, 0.2);
  color: #475569;
}

section {
  margin-bottom: 24px;
  background: white;
  border-radius: 16px;
  padding: 18px;
  border: 1px solid rgba(236, 228, 72, 0.25);
  box-shadow: 0 10px 24px rgba(190, 112, 24, 0.15);
}

pre {
  background: #0f172a;
  color: #f8fafc;
  padding: 12px;
  border-radius: 10px;
  max-height: 200px;
  overflow: auto;
}

button {
  background: linear-gradient(135deg, #ec6b48, #db8d27);
  color: white;
  border: 1px solid transparent;
  padding: 8px 18px;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.15s ease, filter 0.15s ease;
}

button:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
}
</style>
