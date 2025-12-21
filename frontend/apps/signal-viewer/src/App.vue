<template>
  <div class="page">
    <h1>Signal Viewer（signal-viewer.xxx.com）订阅中心</h1>
    <p>通过公共 comms.xxx.com 中继页接入 Signal Hub 实时消息，同时监听 BroadcastChannel 以防止 iframe 挂掉。</p>

    <section>
      <h2>IframeBridge 消息</h2>
      <button @click="requestSync">向中继页请求最新快照</button>
      <pre>{{ bridgeMessages }}</pre>
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
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useBroadcastChannel } from '../../packages/local-comm/src';
import { IframeBridge } from '../../packages/bridge-sdk/src';

const bridge = new IframeBridge({
  bridgeUrl: 'https://comms.xxx.com/index.html',
  channelName: 'signal-sync-bridge',
  allowedOrigins: ['https://signal-hub.xxx.com', 'https://signal-viewer.xxx.com', 'https://comms.xxx.com'],
  targetOrigin: 'https://comms.xxx.com',
  hmacSecret: 'demo-shared-secret',
});
const bridgeMessages = ref<string[]>([]);
let disposeBridge: (() => void) | undefined;

const { history: channelHistory } = useBroadcastChannel<Record<string, unknown>>('signal-sync-alerts', 'signal-viewer');

const sseMirror = ref<string[]>([]);
let eventSource: EventSource | null = null;

const requestSync = () => bridge.send('signal-viewer-sync-request', { ts: Date.now() });

onMounted(async () => {
  await bridge.init();
  disposeBridge = bridge.onMessage((msg) => {
    bridgeMessages.value = [`${msg.type}: ${JSON.stringify(msg.payload)}`, ...bridgeMessages.value].slice(0, 10);
  });

  eventSource = new EventSource('http://localhost:7001/api/sse/stream?consumer=signal-viewer');
  eventSource.onmessage = (event) => {
    sseMirror.value = [`SSE ${event.data}`, ...sseMirror.value].slice(0, 6);
  };
});

onBeforeUnmount(() => {
  disposeBridge?.();
  eventSource?.close();
});
</script>

<style scoped>
.page {
  padding: 24px;
  font-family: 'SF Pro', 'Microsoft Yahei', sans-serif;
}
section {
  margin-bottom: 24px;
}
pre {
  background: #0f172a;
  color: #f8fafc;
  padding: 12px;
  border-radius: 8px;
}
button {
  background: #ec4899;
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
}
</style>
