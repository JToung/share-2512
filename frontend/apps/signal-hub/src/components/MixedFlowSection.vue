<template>
  <section class="mixed-flow">
    <div class="section-heading">
      <h2>混合增强：SSE/WebSocket + iframe 通讯桥</h2>
      <p class="section-subtitle">
        SSE 收到后立刻通过 iframeBridge + BroadcastChannel fan-out，若断线则 fallback HTTP 轮询并补写 WebSocket。
      </p>
    </div>
    <ul class="flow-timeline">
      <li v-for="(log, index) in mixedFlowLog" :key="`${log}-${index}`">
        <span class="step-dot" />
        <span class="entry">{{ log }}</span>
      </li>
      <li v-if="!mixedFlowLog.length" class="empty">
        <span class="step-dot muted" />
        <span class="entry">等待事件中，触发 SSE 或 WebSocket 后可查看完整链路。</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, unref, type Ref } from 'vue';

const props = defineProps<{
  mixedFlowLog: string[] | Ref<string[]>;
}>();

const mixedFlowLog = computed(() => unref(props.mixedFlowLog));
</script>

<style scoped>
.mixed-flow {
  border: none;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.section-heading {
  padding: 22px 24px;
  border-radius: var(--sh-radius);
  border: 1px solid rgba(5, 150, 105, 0.25);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(59, 130, 246, 0.08));
  margin-bottom: 18px;
}

.section-subtitle {
  margin: 8px 0 0;
  color: rgba(15, 118, 110, 0.9);
  font-size: 14px;
}

.flow-timeline {
  list-style: none;
  margin: 0;
  padding: 0 0 0 12px;
  border-left: 2px solid rgba(5, 150, 105, 0.3);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.flow-timeline li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  animation: fadeIn 0.4s ease;
}

.step-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #0d9488;
  border: 2px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.25);
  flex-shrink: 0;
  margin-top: 4px;
}

.step-dot.muted {
  background: rgba(148, 163, 184, 0.8);
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.25);
}

.entry {
  flex: 1;
  background: #fff;
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
  font-size: 14px;
}

.empty .entry {
  color: var(--sh-muted);
  font-style: italic;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
