import { onBeforeUnmount, ref, Ref, watch } from 'vue';

/** 本地通信统一的 Envelope，方便追踪消息来源与时间戳。 */
export interface BroadcastEnvelope<T> {
  id: string;
  source: string;
  payload: T;
  timestamp: number;
}

function buildEnvelope<T>(source: string, payload: T): BroadcastEnvelope<T> {
  return {
    id: crypto.randomUUID(),
    source,
    payload,
    timestamp: Date.now(),
  };
}

export interface BroadcastChannelOptions<T> {
  historyLimit?: number;
  onMessage?: (payload: T, event: BroadcastMessageEvent<T>) => void;
}

export interface BroadcastMessageEvent<T> {
  envelope: BroadcastEnvelope<T>;
  rawEvent: MessageEvent<BroadcastEnvelope<T>>;
}

export interface BroadcastChannelComposable<T> {
  lastMessage: Ref<T | null>;
  history: Ref<BroadcastEnvelope<T>[]>;
  post: (payload: T) => void;
  close: () => void;
}

/** BroadcastChannel 的 Vue 友好封装，附带消息历史与 onMessage。 */
export function useBroadcastChannel<T>(
  name: string,
  source: string,
  options: BroadcastChannelOptions<T> = {}
): BroadcastChannelComposable<T> {
  const { historyLimit = 20, onMessage } = options;
  const channel = new BroadcastChannel(name);
  const history = ref<BroadcastEnvelope<T>[]>([]);
  const lastMessage = ref<T | null>(null);

  const pushHistory = (envelope: BroadcastEnvelope<T>) => {
    history.value = [envelope, ...history.value].slice(0, historyLimit);
    lastMessage.value = envelope.payload;
  };

  const handler = (event: MessageEvent<BroadcastEnvelope<T>>) => {
    console.log('收到BroadcastChannel消息：', event.data)
    pushHistory(event.data);
    onMessage?.(event.data.payload, { envelope: event.data, rawEvent: event });
  };

  channel.addEventListener('message', handler);

  const post = (payload: T) => {
    const envelope = buildEnvelope(source, payload);
    pushHistory(envelope);
    channel.postMessage(envelope);
  };

  const close = () => channel.close();

  onBeforeUnmount(close);

  return { lastMessage, history, post, close };
}

export interface LocalStorageSyncOptions<T> {
  serializer?: (value: T) => string;
  deserializer?: (raw: string | null) => T;
  onRemoteUpdate?: (value: T) => void;
}

/** 基于 localStorage + storage 事件的双向同步 Hook。 */
export function useLocalStorageSync<T>(
  key: string,
  initialValue: T,
  options: LocalStorageSyncOptions<T> = {}
) {
  const {
    serializer = JSON.stringify,
    deserializer = (raw: string | null) => (raw ? JSON.parse(raw) : initialValue),
    onRemoteUpdate,
  } = options;

  const state = ref<T>(deserializer(localStorage.getItem(key)));

  const write = (value: T) => {
    state.value = value;
    localStorage.setItem(key, serializer(value));
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== key || event.storageArea !== localStorage) {
      return;
    }
    const value = deserializer(event.newValue);
    state.value = value;
    onRemoteUpdate?.(value);
  };

  window.addEventListener('storage', storageHandler);
  onBeforeUnmount(() => window.removeEventListener('storage', storageHandler));

  watch(state, (value) => localStorage.setItem(key, serializer(value)), {
    deep: true,
  });

  return {
    state,
    write,
  };
}

/** 网络抖动时的兜底轮询工具，保持接口一致性。 */
export async function httpPoll<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Polling failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface LocalStorageBroadcastDetail<T> {
  key: string;
  value: T;
}

export interface LocalStorageObserverOptions<T> {
  deserializer?: (raw: string | null) => T;
  customEvent?: string;
}

/** 侦听指定 localStorage key 的变化（含 storage 事件与可选自定义事件，用于本页写入）。 */
export function useLocalStorageObserver<T>(
  key: string,
  initialValue: T,
  options: LocalStorageObserverOptions<T> = {}
) {
  const { deserializer = (raw: string | null) => (raw ? (JSON.parse(raw) as T) : initialValue), customEvent } = options;

  const state = ref<T>(initialValue);

  const read = () => {
    try {
      state.value = deserializer(localStorage.getItem(key));
    } catch (error) {
      console.warn('[useLocalStorageObserver] Failed to parse localStorage value:', error);
      state.value = initialValue;
    }
    return state.value;
  };

  read();

  const storageHandler = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || event.key !== key) {
      return;
    }
    read();
  };
  window.addEventListener('storage', storageHandler);

  let customHandler: ((event: Event) => void) | undefined;
  if (customEvent) {
    customHandler = (event: Event) => {
      const detail = (event as CustomEvent<LocalStorageBroadcastDetail<T>>).detail;
      if (!detail || detail.key !== key) {
        return;
      }
      state.value = detail.value;
    };
    window.addEventListener(customEvent, customHandler as EventListener);
  }

  onBeforeUnmount(() => {
    window.removeEventListener('storage', storageHandler);
    if (customEvent && customHandler) {
      window.removeEventListener(customEvent, customHandler as EventListener);
    }
  });

  return {
    state,
    refresh: read,
  };
}
