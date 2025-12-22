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

/** 创建带自动重连与心跳的 WebSocket 客户端，便于在 Vue 组件中复用。 */
export function createWsClient(url: string, options: WsClientOptions = {}): WsClient {
  const { reconnectDelay = 2_000, heartbeatInterval = 10_000, logger = () => undefined } = options;
  const status = ref<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');

  let socket: WebSocket | null = null;
  let heartbeatTimer: number | null = null;
  let reconnectTimer: number | null = null;

  const clearHeartbeat = () => {
    // 防止重复计时器，确保设备休眠后不会持续发送。
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    // 避免在手动 close 后继续重连，因此需检测状态。
    if (reconnectTimer || status.value === 'closed') {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
  };

  const startHeartbeat = () => {
    // 发送轻量 heartbeat，便于后端检测连接健康度。
    clearHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
      }
    }, heartbeatInterval);
  };

  const connect = () => {
    // 对上行/下行统一打点，排查时可快速定位阶段。
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
