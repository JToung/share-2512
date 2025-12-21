<template>
  <div class="page">
    <header>
      <h1>Signal Hub（signal-hub.xxx.com）前端通讯演示</h1>
      <p>
        同域优先使用浏览器原生能力，跨域通过公共中继页隔离，实时通讯在 WebSocket/SSE 之上叠加本地桥接，确保网络抖动下仍能保持多端一致。
      </p>
      <p class="hint">最近一次网络抖动补偿耗时：{{ lastGap }} ms</p>
    </header>

    <section>
      <h2>浏览器本地通讯：localStorage + BroadcastChannel</h2>
      <div class="grid">
        <article>
          <h3>localStorage 同步</h3>
          <textarea v-model="newLocalAlert" placeholder="输入示例消息..." />
          <button @click="pushLocal">localStorage 写入 + storage 事件</button>
          <pre>{{ localCache.state }}</pre>
        </article>
        <article>
          <h3>BroadcastChannel</h3>
          <textarea v-model="newBroadcastAlert" placeholder="广播事件..." />
          <button @click="emitBroadcast">channel.postMessage</button>
          <pre>{{ broadcastHistory }}</pre>
        </article>
      </div>
    </section>

    <section>
      <h2>跨域 iframes 通讯：postMessage + 公共中继页</h2>
      <p>
        iframeBridge 负责 origin 白名单、targetOrigin、sandbox、HMAC、timestamp/nonce 防重放，并将 iframe 广播到 BroadcastChannel，供其他标签页二次消费。
      </p>
      <button @click="replayIframe">向 comms.xxx.com 派发数据</button>
      <button @click="broadcastViaBridge">将最新 SSE 消息写入桥</button>
      <pre>{{ bridgeLog }}</pre>
    </section>

    <section>
      <h2>前后端通讯对比</h2>
      <div class="grid">
        <article>
          <h3>HTTP 轮询</h3>
          <p>简单可控，但会占用带宽。</p>
          <pre>{{ pollSnapshot }}</pre>
        </article>
        <article>
          <h3>SSE（推荐用于跨平台接收）</h3>
          <p>后端：/api/sse/stream</p>
          <pre>{{ sseEvents }}</pre>
          <button @click="reconnectSse">重新建立 SSE</button>
        </article>
        <article>
          <h3>WebSocket（跨平台发送）</h3>
          <p>状态：{{ wsStatus }}</p>
          <textarea v-model="newWsMessage" placeholder="输入需要推送的策略" />
          <button @click="sendWs">发送到后端 WebSocket</button>
        </article>
      </div>
    </section>

    <section>
      <h2>混合增强：SSE/WebSocket + iframe 通讯桥</h2>
      <p>
        SSE 消息到达即通过 iframeBridge + BroadcastChannel 写入本地，若 SSE 断开则 fallback 至 HTTP 轮询，保持所有终端面板一致。
      </p>
      <pre>{{ mixedFlowLog }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { httpPoll, useBroadcastChannel, useLocalStorageSync } from '../../packages/local-comm/src';
import { createWsClient } from '../../packages/ws-client/src';
import { IframeBridge } from '../../packages/bridge-sdk/src';
import { useMessageStore } from './stores/messageStore';

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

const wsClient = createWsClient('ws://localhost:7001/ws/signal-hub', {
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
let pollTimer: number | null = null;

const iframeBridge = new IframeBridge({
  bridgeUrl: 'https://comms.xxx.com/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['https://signal-hub.xxx.com', 'https://signal-viewer.xxx.com', 'https://comms.xxx.com'],
  targetOrigin: 'https://comms.xxx.com',
  hmacSecret: 'demo-shared-secret',
});
const bridgeLog = ref<string[]>([]);
let disposeBridge: (() => void) | undefined;

const mixedFlowLog = ref<string[]>([]);

const lastGap = computed(() => messageStore.lastNetworkGapMs);

function pushLocal() {
  if (!newLocalAlert.value) return;
  localCache.write([...localCache.state.value, `${Date.now()}: ${newLocalAlert.value}`]);
  newLocalAlert.value = '';
}

function emitBroadcast() {
  if (!newBroadcastAlert.value) return;
  broadcastPost(`[SignalHub] ${newBroadcastAlert.value}`);
  newBroadcastAlert.value = '';
}

function sendWs() {
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

function replayIframe() {
  iframeBridge.send('signal-hub-alert', {
    body: `Manual replay ${Date.now()}`,
  });
}

function broadcastViaBridge() {
  const latest = sseEvents.value[0];
  if (!latest) return;
  iframeBridge.send('sse-mirror', { body: latest });
}

function recordMixedFlow(step: string) {
  mixedFlowLog.value = [`${new Date().toISOString()} ${step}`, ...mixedFlowLog.value].slice(0, 6);
}

const startSse = () => {
  recordMixedFlow('SSE connecting...');
  eventSource = new EventSource('http://localhost:7001/api/sse/stream');
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

onMounted(async () => {
  wsClient.connect();
  startSse();
  startPolling();
  await iframeBridge.init();
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
.page {
  padding: 24px;
  font-family: 'SF Pro', 'Microsoft Yahei', sans-serif;
  color: #0f172a;
}
header {
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 24px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
section {
  margin-bottom: 32px;
}
article, textarea, pre {
  border: 1px solid #cbd5f5;
  border-radius: 8px;
  padding: 12px;
  background: #f8fafc;
}
textarea {
  min-height: 90px;
}
pre {
  max-height: 180px;
  overflow: auto;
}
button {
  margin-top: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  border: none;
  background: #2563eb;
  color: white;
  cursor: pointer;
}
button + button {
  margin-left: 8px;
}
.hint {
  color: #059669;
}
</style>
