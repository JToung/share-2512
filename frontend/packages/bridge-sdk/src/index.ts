export interface BridgeMessage<T> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  nonce: string;
  signature: string;
}

export interface IframeBridgeOptions {
  bridgeUrl: string;
  channelName: string;
  allowedOrigins: string[];
  targetOrigin: string;
  hmacSecret: string;
  replayWindowMs?: number;
  sandboxPermissions?: string[];
}

export type BridgeHandler<T> = (message: BridgeMessage<T>) => void;

const encoder = new TextEncoder();

/**
 * Secure iframe bridge that combines postMessage + BroadcastChannel + HMAC protection.
 */
export class IframeBridge<T = unknown> {
  private iframe?: HTMLIFrameElement;
  private readyPromise?: Promise<void>;
  private handlers = new Set<BridgeHandler<T>>();
  private broadcast?: BroadcastChannel;
  private cryptoKeyPromise?: Promise<CryptoKey>;
  private seenNonces = new Map<string, number>();

  constructor(private options: IframeBridgeOptions) {
    window.addEventListener('message', this.handleMessage);
    window.addEventListener('beforeunload', () => this.destroy());
  }

  /** Lazy load the iframe and wait until it is ready. */
  async init(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.broadcast = new BroadcastChannel(this.options.channelName);
    this.broadcast.addEventListener('message', (event) => {
      const envelope = event.data as BridgeMessage<T>;
      if (this.isTrustedOrigin(event.origin ?? window.location.origin) && this.verifyNonce(envelope)) {
        this.handlers.forEach((handler) => handler(envelope));
      }
    });

    this.readyPromise = new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.src = this.options.bridgeUrl;
      iframe.loading = 'lazy';
      iframe.style.display = 'none';
      iframe.sandbox.add('allow-scripts', 'allow-same-origin');
      this.options.sandboxPermissions?.forEach((perm) => iframe.sandbox.add(perm as DOMTokenList['value']));

      const cleanup = () => iframe.remove();

      iframe.addEventListener('load', () => {
        this.iframe = iframe;
        resolve();
      });

      iframe.addEventListener('error', (error) => {
        cleanup();
        reject(error);
      });

      document.body.appendChild(iframe);
    });

    return this.readyPromise;
  }

  async send(type: string, payload: T) {
    await this.init();
    const envelope = await this.buildMessage(type, payload);
    this.iframe?.contentWindow?.postMessage(envelope, this.options.targetOrigin);
    this.broadcast?.postMessage(envelope);
  }

  onMessage(handler: BridgeHandler<T>): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  destroy() {
    this.broadcast?.close();
    if (this.iframe?.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    window.removeEventListener('message', this.handleMessage);
    this.handlers.clear();
  }

  private handleMessage = async (event: MessageEvent<BridgeMessage<T>>) => {
    if (!this.isTrustedOrigin(event.origin)) {
      return;
    }

    const envelope = event.data;
    if (!this.verifyNonce(envelope)) {
      return;
    }

    const isValidSignature = await this.verifySignature(envelope);
    if (!isValidSignature) {
      return;
    }

    this.handlers.forEach((handler) => handler(envelope));
  };

  private isTrustedOrigin(origin: string) {
    return this.options.allowedOrigins.includes(origin);
  }

  private async buildMessage(type: string, payload: T): Promise<BridgeMessage<T>> {
    const message: BridgeMessage<T> = {
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
      signature: '',
    };
    message.signature = await this.createSignature(message);
    return message;
  }

  private async getCryptoKey(): Promise<CryptoKey> {
    if (!this.cryptoKeyPromise) {
      this.cryptoKeyPromise = crypto.subtle.importKey(
        'raw',
        encoder.encode(this.options.hmacSecret),
        {
          name: 'HMAC',
          hash: 'SHA-256',
        },
        false,
        ['sign', 'verify']
      );
    }
    return this.cryptoKeyPromise;
  }

  private async createSignature(message: BridgeMessage<T>) {
    const key = await this.getCryptoKey();
    const data = encoder.encode(
      `${message.type}|${message.timestamp}|${message.nonce}|${JSON.stringify(message.payload)}`
    );
    const signature = await crypto.subtle.sign('HMAC', key, data);
    return Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  private async verifySignature(message: BridgeMessage<T>): Promise<boolean> {
    const key = await this.getCryptoKey();
    const data = encoder.encode(
      `${message.type}|${message.timestamp}|${message.nonce}|${JSON.stringify(message.payload)}`
    );
    const signatureBytes = Uint8Array.from(message.signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);
    return crypto.subtle.verify('HMAC', key, signatureBytes, data);
  }

  private verifyNonce(message: BridgeMessage<T>): boolean {
    const windowMs = this.options.replayWindowMs ?? 15_000;
    if (Date.now() - message.timestamp > windowMs) {
      return false;
    }
    if (this.seenNonces.has(message.nonce)) {
      return false;
    }
    this.seenNonces.set(message.nonce, message.timestamp);
    // prune
    this.seenNonces.forEach((ts, nonce) => {
      if (Date.now() - ts > windowMs) {
        this.seenNonces.delete(nonce);
      }
    });
    return true;
  }
}
