import { Ref, ref } from 'vue';

export interface WsClientOptions {
  reconnectDelay?: number;
  heartbeatInterval?: number;
  logger?: (message: string, payload?: unknown) => void;
}

export interface WsClient {
  status: Ref<'idle' | 'connecting' | 'open' | 'closed' | 'error'>;
  connect: () => void;
  send: (payload: unknown) => void;
  close: () => void;
}

/**
 * Creates a resilient WebSocket client with automatic reconnection and heartbeat frames.
 */
export function createWsClient(url: string, options: WsClientOptions = {}): WsClient {
  const { reconnectDelay = 2_000, heartbeatInterval = 10_000, logger = () => undefined } = options;
  const status = ref<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');

  let socket: WebSocket | null = null;
  let heartbeatTimer: number | null = null;
  let reconnectTimer: number | null = null;

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer || status.value === 'closed') {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
  };

  const startHeartbeat = () => {
    clearHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
      }
    }, heartbeatInterval);
  };

  const connect = () => {
    status.value = 'connecting';
    socket = new WebSocket(url);

    socket.onopen = () => {
      status.value = 'open';
      startHeartbeat();
      logger('ws:open');
    };

    socket.onmessage = (event) => {
      logger('ws:message', event.data);
    };

    socket.onerror = (event) => {
      status.value = 'error';
      logger('ws:error', event);
    };

    socket.onclose = () => {
      clearHeartbeat();
      if (status.value !== 'closed') {
        status.value = 'error';
        scheduleReconnect();
      }
      logger('ws:close');
    };
  };

  const send = (payload: unknown) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    socket.send(JSON.stringify(payload));
  };

  const close = () => {
    status.value = 'closed';
    clearHeartbeat();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  return { status, connect, send, close };
}
