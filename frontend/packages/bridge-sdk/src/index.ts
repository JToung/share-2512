/** iframe / BroadcastChannel 消息统一结构 */
export interface BridgeMessage<T> {
  id: string
  type: string
  payload: T
  timestamp: number
  nonce: string
  signature: string
}

export interface IframeBridgeOptions {
  bridgeUrl: string
  channelName: string
  allowedOrigins: string[]
  targetOrigin: string
  hmacSecret: string
  replayWindowMs?: number
  sandboxPermissions?: string[]
}

export type BridgeHandler<T> = (message: BridgeMessage<T>) => void

const encoder = new TextEncoder()

/**
 * postMessage + BroadcastChannel + HMAC 的安全 iframe Bridge
 */
export class IframeBridge<T = unknown> {
  private iframe?: HTMLIFrameElement
  private readyPromise?: Promise<void>
  private handlers = new Set<BridgeHandler<T>>()
  private broadcast?: BroadcastChannel
  private cryptoKeyPromise?: Promise<CryptoKey>
  private seenNonces = new Map<string, number>()

  constructor(private options: IframeBridgeOptions) {
    window.addEventListener('message', this.handleWindowMessage)
    window.addEventListener('beforeunload', () => this.destroy())
  }

  /** 懒加载 iframe */
  async init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise

    this.broadcast = new BroadcastChannel(this.options.channelName)
    this.broadcast.addEventListener('message', this.handleBroadcastMessage)

    this.readyPromise = new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe')
      iframe.src = this.options.bridgeUrl
      iframe.loading = 'lazy'
      iframe.style.display = 'none'
      iframe.sandbox.add('allow-scripts', 'allow-same-origin')

      this.options.sandboxPermissions?.forEach((p) =>
        iframe.sandbox.add(p as DOMTokenList['value'])
      )

      iframe.onload = () => {
        this.iframe = iframe
        resolve()
      }

      iframe.onerror = (e) => {
        iframe.remove()
        reject(e)
      }

      document.body.appendChild(iframe)
    })

    return this.readyPromise
  }

  /** 发送消息（iframe + BC 双通道） */
  async send(type: string, payload: T) {
    await this.init()
    const message = await this.buildMessage(type, payload)

    this.iframe?.contentWindow?.postMessage(
      message,
      this.options.targetOrigin
    )

    this.broadcast?.postMessage(message)
  }

  /** 注册监听 */
  onMessage(handler: BridgeHandler<T>): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  destroy() {
    this.broadcast?.close()
    this.broadcast = undefined

    this.iframe?.remove()
    this.iframe = undefined

    window.removeEventListener('message', this.handleWindowMessage)
    this.handlers.clear()
    this.seenNonces.clear()
  }

  // ================== Message Handlers ==================

  private handleWindowMessage = async (
    event: MessageEvent<BridgeMessage<T>>
  ) => {
    if (!this.isTrustedOrigin(event.origin)) return
    await this.processMessage(event.data)
  }

  private handleBroadcastMessage = async (
    event: MessageEvent<BridgeMessage<T>>
  ) => {
    await this.processMessage(event.data)
  }

  private async processMessage(message: BridgeMessage<T>) {
    if (!this.verifyNonce(message)) return
    if (!(await this.verifySignature(message))) return

    this.handlers.forEach((h) => h(message))
  }

  private isTrustedOrigin(origin: string) {
    return this.options.allowedOrigins.includes(origin)
  }

  // ================== Crypto ==================

  private async getCryptoKey(): Promise<CryptoKey> {
    if (!this.cryptoKeyPromise) {
      this.cryptoKeyPromise = crypto.subtle.importKey(
        'raw',
        encoder.encode(this.options.hmacSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      )
    }
    return this.cryptoKeyPromise
  }

  private serializeForSign(message: BridgeMessage<T>) {
    return `${message.type}|${message.timestamp}|${message.nonce}|${JSON.stringify(
      message.payload
    )}`
  }

  /** 生成 HMAC 签名 */
  private async createSignature(message: BridgeMessage<T>): Promise<string> {
    const key = await this.getCryptoKey()
    const data = encoder.encode(this.serializeForSign(message))
    const sig = await crypto.subtle.sign('HMAC', key, data)
    return [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /** 校验 HMAC */
  private async verifySignature(message: BridgeMessage<T>): Promise<boolean> {
    const key = await this.getCryptoKey()
    const data = encoder.encode(this.serializeForSign(message))

    const bytes =
      message.signature.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []

    return crypto.subtle.verify(
      'HMAC',
      key,
      new Uint8Array(bytes),
      data
    )
  }

  // ================== Replay Protection ==================

  /** timestamp + nonce 防重放 */
  private verifyNonce(message: BridgeMessage<T>): boolean {
    const windowMs = this.options.replayWindowMs ?? 15_000
    const now = Date.now()

    if (now - message.timestamp > windowMs) return false
    if (this.seenNonces.has(message.nonce)) return false

    this.seenNonces.set(message.nonce, message.timestamp)

    // prune
    for (const [nonce, ts] of this.seenNonces) {
      if (now - ts > windowMs) {
        this.seenNonces.delete(nonce)
      }
    }

    return true
  }

  // ================== Builder ==================

  private async buildMessage(
    type: string,
    payload: T
  ): Promise<BridgeMessage<T>> {
    const message: BridgeMessage<T> = {
      id: crypto.randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
      signature: '',
    }

    message.signature = await this.createSignature(message)
    return message
  }
}