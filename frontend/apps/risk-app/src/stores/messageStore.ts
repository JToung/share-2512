import { defineStore } from 'pinia';

export interface AlertMessage {
  id: string;
  channel: 'local' | 'broadcast' | 'sse' | 'ws' | 'iframe';
  body: string;
  createdAt: number;
}

export const useMessageStore = defineStore('messageStore', {
  state: () => ({
    messages: [] as AlertMessage[],
    lastNetworkGapMs: 0,
  }),
  actions: {
    pushMessage(message: AlertMessage) {
      this.messages.unshift(message);
      this.messages = this.messages.slice(0, 50);
    },
    trackNetworkGap(ms: number) {
      this.lastNetworkGapMs = ms;
    },
  },
});
