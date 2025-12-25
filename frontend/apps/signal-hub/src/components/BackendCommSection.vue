<template>
  <section class="backend-comm">
    <div class="section-heading">
      <h2>前后端通讯对比</h2>
    </div>
    <div class="grid transport-grid">
      <article class="transport-card">
        <div class="card-head">
          <h3>WebSocket（跨平台发送）</h3>
          <span class="chip accent">Bidirectional</span>
        </div>
        <p class="ws-status">
          <span class="status-dot" :class="wsStatusTone" />
          状态
          <span class="status-pill" :class="wsStatusTone">{{ wsStatus }}</span>
        </p>
        <textarea v-model="wsMessageModel" placeholder="输入需要推送的策略" />
        <button @click="emit('send-ws')">发送到后端 WebSocket</button>
        <div class="ws-log-panel">
          <div class="snapshot-panel">
            <span class="panel-label">发送日志</span>
            <pre>{{ wsSendLogText }}</pre>
          </div>
          <div class="snapshot-panel">
            <span class="panel-label">接收日志</span>
            <pre>{{ wsReceiveLogText }}</pre>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, unref, type Ref } from 'vue';

type MaybeRef<T> = T | Ref<T>;

const props = defineProps<{
  pollSnapshot: MaybeRef<unknown[]>;
  pollingEnabled: MaybeRef<boolean>;
  sseEvents: MaybeRef<unknown[]>;
  wsStatus: MaybeRef<string>;
  newWsMessage: string;
  wsSendLog: MaybeRef<string[]>;
  wsReceiveLog: MaybeRef<string[]>;
}>();

const emit = defineEmits<{
  (e: 'toggle-polling'): void;
  (e: 'reconnect-sse'): void;
  (e: 'send-ws'): void;
  (e: 'update:newWsMessage', value: string): void;
}>();

const wsMessageModel = computed({
  get: () => props.newWsMessage,
  set: (value: string) => emit('update:newWsMessage', value),
});

const wsStatus = computed(() => unref(props.wsStatus));
const wsSendLog = computed(() => unref(props.wsSendLog) ?? []);
const wsReceiveLog = computed(() => unref(props.wsReceiveLog) ?? []);
const wsStatusTone = computed(() => {
  const status = `${wsStatus.value ?? ''}`.toLowerCase();
  if (status.includes('open')) return 'tone-open';
  if (status.includes('connect')) return 'tone-wait';
  if (status.includes('error')) return 'tone-error';
  if (status.includes('closed')) return 'tone-closed';
  return 'tone-idle';
});
const wsSendLogText = computed(() =>
  wsSendLog.value.length ? wsSendLog.value.join('\n') : '暂无记录'
);
const wsReceiveLogText = computed(() =>
  wsReceiveLog.value.length ? wsReceiveLog.value.join('\n') : '暂无记录'
);
</script>

<style scoped>
.backend-comm {
  border: none;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.section-heading {
  padding: 22px 24px;
  border-radius: var(--sh-radius);
  background: rgba(15, 23, 42, 0.02);
  border: 1px solid rgba(15, 23, 42, 0.08);
  margin-bottom: 20px;
}

.section-subtitle {
  margin: 6px 0 0;
  color: var(--sh-muted);
  font-size: 14px;
}

.transport-grid {
  gap: 18px;
}

.transport-card {
  border-radius: var(--sh-radius);
  padding: 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 15px 35px rgba(15, 23, 42, 0.06);
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  overflow: hidden;
}

.transport-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 90% 10%, rgba(37, 99, 235, 0.06), transparent 60%);
  pointer-events: none;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.chip {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 999px;
  padding: 4px 12px;
  background: rgba(100, 116, 139, 0.12);
  color: var(--sh-muted);
  font-weight: 600;
}

.chip.hot {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}

.chip.accent {
  background: rgba(16, 185, 129, 0.18);
  color: #0d9488;
}

.card-subtitle {
  margin: 0;
  color: var(--sh-muted);
  font-size: 14px;
  position: relative;
  z-index: 1;
}

.snapshot-panel {
  border-radius: 16px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px dashed rgba(15, 23, 42, 0.15);
  margin-top: 4px;
  position: relative;
  z-index: 1;
}

.panel-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sh-muted);
}

pre {
  margin: 8px 0 0;
  max-height: 180px;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 12px;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.4);
}

.ghost {
  background: transparent;
  color: var(--sh-primary);
  border: 1px solid rgba(37, 99, 235, 0.4);
  box-shadow: none;
}

.ghost:hover {
  background: rgba(37, 99, 235, 0.05);
}

.ws-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--sh-muted);
  font-weight: 500;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-flex;
  background: rgba(148, 163, 184, 0.6);
}

.status-pill {
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  background: rgba(148, 163, 184, 0.15);
  color: var(--sh-text);
}

.tone-open {
  background: rgba(34, 197, 94, 0.18);
  color: #15803d;
}

.tone-open.status-dot {
  background: #22c55e;
}

.tone-wait {
  background: rgba(249, 115, 22, 0.18);
  color: #b45309;
}

.tone-wait.status-dot {
  background: #f97316;
}

.tone-error,
.tone-closed {
  background: rgba(239, 68, 68, 0.15);
  color: #b91c1c;
}

.tone-error.status-dot,
.tone-closed.status-dot {
  background: #ef4444;
}

.tone-idle {
  background: rgba(148, 163, 184, 0.2);
  color: #475569;
}

.tone-idle.status-dot {
  background: rgba(148, 163, 184, 0.8);
}

.status-pill.tone-open,
.status-pill.tone-wait,
.status-pill.tone-error,
.status-pill.tone-closed,
.status-pill.tone-idle {
  color: inherit;
}

.ws-log-panel {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.ws-log-panel pre {
  min-height: 120px;
}
</style>
