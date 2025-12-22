import { defineStore } from 'pinia';

/** 统一包装所有渠道的消息，便于在面板上展示。 */
export interface AlertMessage {
  id: string;
  channel: 'local' | 'broadcast' | 'sse' | 'ws' | 'iframe';
  body: string;
  createdAt: number;
}

/**
 * Signal Hub 的消息总线：用于演示多通道写入 + 网络抖动指标。
 */
export const useMessageStore = defineStore('messageStore', {
  state: () => ({
    messages: [] as AlertMessage[],
    lastNetworkGapMs: 0,
  }),
  actions: {
    pushMessage(message: AlertMessage) {
      // 只保留最近 50 条，避免示例页渲染过多节点。
      this.messages.unshift(message);
      this.messages = this.messages.slice(0, 50);
    },
    trackNetworkGap(ms: number) {
      // 记录 SSE 断链后的时间差，辅助展示“抖动补偿”。
      this.lastNetworkGapMs = ms;
    },
  },
});
