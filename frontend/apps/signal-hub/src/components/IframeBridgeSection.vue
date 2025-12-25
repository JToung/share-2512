<template>
  <section class="iframe-bridge">
    <div class="section-heading">
      <h2>跨域 iframes 通讯：postMessage + 公共中继页</h2>
      <p class="legend">
        iframeBridge 校验 origin、targetOrigin、HMAC 与 timestamp/nonce 防重放，将消息复制到 BroadcastChannel，确保跨域双写。
      </p>
    </div>
    <textarea
      v-model="newWsMessage"
      placeholder="输入要发送的消息"
      class="message-input"
    />
    <div class="action-row">
      <button @click="emit('replay', newWsMessage)">向 中继页 派发数据</button>
      <button @click="emit('broadcast')">将最新 SSE 消息写入桥</button>
    </div>
    <div class="log-panel">
      <span class="log-label">桥日志</span>
      <pre>{{ bridgeLog }}</pre>
    </div>
    <div class="log-panel snapshot-panel">
      <span class="log-label">localStorage 最新快照</span>
      <pre>{{ storageSnapshotText }}</pre>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, unref, watch, type Ref } from 'vue';

const props = defineProps<{
  bridgeLog: string[] | Ref<string[]>;
  storageSnapshot: unknown | Ref<unknown>;
}>();

const emit = defineEmits<{
  (e: 'replay', message: string): void;
  (e: 'broadcast'): void;
}>();

const newWsMessage = ref('');
const bridgeLog = computed(() => unref(props.bridgeLog));
const storageSnapshotText = ref('暂无快照');

watch(
  () => props.storageSnapshot,
  (snapshot) => {
    storageSnapshotText.value = snapshot ? JSON.stringify(snapshot, null, 2) : '暂无快照';
  },
  { immediate: true }
)
</script>

<style scoped>
.iframe-bridge {
  background: #ffffff;
  color: var(--sh-text);
  border-radius: var(--sh-radius);
  border: 1px solid rgba(37, 99, 235, 0.12);
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
  overflow: hidden;
  position: relative;
}

.section-heading {
  padding: 6px 0 4px;
  margin-bottom: 12px;
}

.legend {
  margin: 8px 0 0;
  color: var(--sh-muted);
  line-height: 1.6;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 18px 0;
}

.iframe-bridge button {
  cursor: pointer;
  border-radius: 12px;
  padding: 10px 18px;
  font-weight: 600;
  border: 1px solid transparent;
  background: linear-gradient(135deg, var(--sh-primary), var(--sh-primary-dark));
  color: #fff;
  transition: transform 0.18s ease, filter 0.18s ease;
}

.iframe-bridge button:hover {
  transform: translateY(-2px);
  filter: brightness(1.05);
}

.ghost {
  background: transparent;
  color: var(--sh-primary);
  border-color: rgba(37, 99, 235, 0.4);
  box-shadow: none;
}

.ghost:hover {
  background: rgba(37, 99, 235, 0.08);
}

.log-panel {
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.02);
  padding: 14px;
  border: 1px dashed rgba(37, 99, 235, 0.25);
}

.snapshot-panel {
  margin-top: 14px;
}

.log-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sh-muted);
}

pre {
  margin: 10px 0 0;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 12px;
  max-height: 200px;
  overflow: auto;
}
</style>
