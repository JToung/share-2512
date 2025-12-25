<template>
  <section class="local-comm">
    <div class="section-heading">
      <h2>浏览器本地通讯：localStorage + BroadcastChannel</h2>
      <p class="section-subtitle">演示 storage 事件与 BroadcastChannel 的互补，检查看板在多标签页下的延迟。</p>
    </div>
    <div class="local-grid">
      <article class="local-card">
        <div class="card-head">
          <h3>localStorage 同步</h3>
          <span class="tag">Storage</span>
        </div>
        <p class="card-subtitle">写入 localStorage 即触发 storage 事件，驱动其他标签页刷新缓存。</p>
        <textarea v-model="localAlertModel" placeholder="输入示例消息..." />
        <div class="actions">
          <button @click="emit('push-local')">localStorage 写入 + storage 事件</button>
        </div>
        <div class="log-panel">
          <span class="log-label">本地缓存</span>
          <pre>{{ localCache }}</pre>
        </div>
      </article>
      <article class="local-card">
        <div class="card-head">
          <h3>BroadcastChannel</h3>
          <span class="tag">Channel</span>
        </div>
        <p class="card-subtitle">通过 channel.postMessage 在同域页面间低延迟广播，作为 storage 的补充。</p>
        <textarea v-model="broadcastAlertModel" placeholder="广播事件..." />
        <div class="actions">
          <button @click="emit('emit-broadcast')">channel.postMessage</button>
        </div>
        <div class="log-panel">
          <span class="log-label">广播历史</span>
          <pre>{{ broadcastHistory }}</pre>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, unref, type Ref } from 'vue';

type MaybeRef<T> = T | Ref<T>;

const props = defineProps<{
  localAlert: string;
  broadcastAlert: string;
  localCache: MaybeRef<unknown[]>;
  broadcastHistory: MaybeRef<unknown[]>;
}>();

const emit = defineEmits<{
  (e: 'push-local'): void;
  (e: 'emit-broadcast'): void;
  (e: 'update:localAlert', value: string): void;
  (e: 'update:broadcastAlert', value: string): void;
}>();

const localAlertModel = computed({
  get: () => props.localAlert,
  set: (value: string) => emit('update:localAlert', value),
});

const broadcastAlertModel = computed({
  get: () => props.broadcastAlert,
  set: (value: string) => emit('update:broadcastAlert', value),
});

const localCache = computed(() => unref(props.localCache));
const broadcastHistory = computed(() => unref(props.broadcastHistory));
</script>

<style scoped>
.local-comm {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.section-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 24px;
  border-radius: var(--sh-radius);
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(37, 99, 235, 0.02));
  border: 1px solid rgba(37, 99, 235, 0.2);
  margin-bottom: 20px;
}

.section-subtitle {
  margin: 0;
  color: var(--sh-muted);
  font-size: 14px;
}

.local-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 20px;
}

.local-card {
  padding: 20px;
  border-radius: var(--sh-radius);
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: linear-gradient(145deg, #ffffff, #f8fbff);
  box-shadow: 0 12px 25px rgba(15, 23, 42, 0.08);
  position: relative;
  overflow: hidden;
}

.local-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at top right, rgba(37, 99, 235, 0.08), transparent 55%);
  pointer-events: none;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.tag {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sh-primary);
  background: rgba(37, 99, 235, 0.08);
  border-radius: 999px;
  padding: 4px 10px;
  font-weight: 600;
}

.card-subtitle {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--sh-muted);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  position: relative;
  z-index: 1;
}

.log-panel {
  background: rgba(15, 23, 42, 0.03);
  border-radius: 14px;
  padding: 12px;
  margin-top: 16px;
  border: 1px dashed rgba(37, 99, 235, 0.25);
  position: relative;
  z-index: 1;
}

.log-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sh-muted);
}

pre {
  margin: 8px 0 0;
  max-height: 160px;
  overflow: auto;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.4);
}

@media (max-width: 640px) {
  .section-heading {
    padding: 18px;
  }
}
</style>
