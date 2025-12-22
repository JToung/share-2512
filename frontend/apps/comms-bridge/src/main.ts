/** 中继页对 postMessage/BroadcastChannel 的 Envelope 定义。 */
interface BridgeMessage<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  nonce: string;
  signature: string;
}

interface ClientInfo {
  origin: string;
  window: Window;
  lastSeen: number;
}

const allowedOrigins = new Set(['https://signal-hub.xxx.com', 'https://signal-viewer.xxx.com']);
// 负责与宿主页共享消息，等同于“二次广播层”。
const broadcastChannel = new BroadcastChannel('signal-sync-bridge');
const clients = new Map<string, ClientInfo>();
const seenNonces = new Set<string>();
const encoder = new TextEncoder();
const hmacSecret = 'demo-shared-secret';
const replayWindowMs = 15_000;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

const handshake = (clientId: string, info: ClientInfo) => {
  // 保存客户端信息，并通过 ack 告知 iframe 已准备就绪。
  clients.set(clientId, info);
  info.window.postMessage(
    {
      id: crypto.randomUUID(),
      type: 'bridge:ack',
      payload: { clientId, ts: Date.now() },
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
      signature: 'bridge-ack',
    },
    info.origin
  );
};

const pruneClients = () => {
  // 定期清理长时间不活跃的窗口，避免持有失效引用。
  const now = Date.now();
  [...clients.entries()].forEach(([clientId, info]) => {
    if (now - info.lastSeen > 60_000) {
      clients.delete(clientId);
    }
  });
};

const handleBridgeMessage = async (event: MessageEvent<BridgeMessage>) => {
  // 核心入口：校验来源、timestamp、nonce、HMAC 后再转发。
  if (!event.source || !allowedOrigins.has(event.origin)) {
    return;
  }

  const data = event.data;
  if (!verifyTimestamp(data) || !verifyNonce(data) || !(await verifySignature(data))) {
    return;
  }

  if (data.type === 'bridge:hello') {
    handshake(event.origin, { origin: event.origin, window: event.source as Window, lastSeen: Date.now() });
  } else {
    broadcastChannel.postMessage(data);
  }

  clients.forEach((client, clientId) => {
    if (client.origin === event.origin) {
      clients.set(clientId, { ...client, lastSeen: Date.now() });
      return;
    }
    try {
      client.window.postMessage(data, client.origin);
    } catch {
      clients.delete(clientId);
    }
  });
};

broadcastChannel.addEventListener('message', (event) => {
  const envelope = event.data as BridgeMessage;
  clients.forEach((client) => {
    client.window.postMessage(envelope, client.origin);
  });
});

window.addEventListener('message', (event) => {
  handleBridgeMessage(event);
});

window.addEventListener('beforeunload', () => {
  broadcastChannel.close();
  clients.clear();
});

function verifyTimestamp(message: BridgeMessage) {
  return Date.now() - message.timestamp < replayWindowMs;
}

function verifyNonce(message: BridgeMessage) {
  if (seenNonces.has(message.nonce)) {
    return false;
  }
  seenNonces.add(message.nonce);
  window.setTimeout(() => seenNonces.delete(message.nonce), replayWindowMs);
  return true;
}

async function verifySignature(message: BridgeMessage) {
  const key = await getCryptoKey();
  const payload = encoder.encode(`${message.type}|${message.timestamp}|${message.nonce}|${JSON.stringify(message.payload)}`);
  const bytes = Uint8Array.from(message.signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);
  return crypto.subtle.verify('HMAC', key, bytes, payload);
}

function getCryptoKey() {
  if (!cryptoKeyPromise) {
    cryptoKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(hmacSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }
  return cryptoKeyPromise;
}

window.setInterval(pruneClients, 30_000);
