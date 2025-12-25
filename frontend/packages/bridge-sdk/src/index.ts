/** iframe / BroadcastChannel 消息统一结构
 * 作为 Bridge 内部通信的标准 Envelope
 */
export interface BridgeMessage<T> {
  /** 消息唯一 ID（调试 / 追踪用） */
  id: string

  /** 消息类型（业务事件名 / 协议指令） */
  type: string

  /** 实际业务数据 */
  payload: T

  /** 发送时间戳（用于重放攻击防护） */
  timestamp: number

  /** 随机 nonce（确保消息唯一性） */
  nonce: string

  /** HMAC 签名（防篡改） */
  signature: string

  /** 消息来源客户端 ID（区分多个实例） */
  sourceId: string
}

/** 本地快照广播事件名 */
export const BRIDGE_SNAPSHOT_EVENT = 'bridge:snapshot'

/** 快照事件携带的数据结构 */
export interface BridgeSnapshotEventDetail<T> {
  key: string
  value: BridgeMessage<T>
}

/** iframe Bridge 初始化参数 */
export interface IframeBridgeOptions {
  /** 中继页 URL */
  bridgeUrl: string

  /** BroadcastChannel 名称（同域通信） */
  channelName: string

  /** postMessage 来源白名单 */
  allowedOrigins: string[]

  /** postMessage 的 targetOrigin */
  targetOrigin: string

  /** HMAC 密钥（与中继页约定） */
  hmacSecret: string

  /** 防重放时间窗口（毫秒，默认 15s） */
  replayWindowMs?: number

  /** iframe sandbox 额外权限 */
  sandboxPermissions?: string[]

  /** 快照存储 key（用于状态恢复 / 调试） */
  storageKey?: string
}

/** 业务层消息处理函数 */
export type BridgeHandler<T> = (message: BridgeMessage<T>) => void

/** TextEncoder 复用实例 */
const encoder = new TextEncoder()

/**
 * 基于 postMessage + BroadcastChannel + HMAC 的安全 iframe Bridge
 *
 * 目标：
 * - iframe 作为跨域隔离层
 * - BroadcastChannel 优化同域通信
 * - HMAC 校验消息完整性
 * - nonce + timestamp 防止重放攻击
 */
export class IframeBridge<T = unknown> {
  /** 隐藏 iframe 实例 */
  private iframe?: HTMLIFrameElement

  /** iframe 初始化 Promise（防止重复创建） */
  private readyPromise?: Promise<void>

  /** 已注册的业务监听器 */
  private handlers = new Set<BridgeHandler<T>>()

  /** BroadcastChannel 实例 */
  private broadcast?: BroadcastChannel

  /** CryptoKey 懒加载缓存 */
  private cryptoKeyPromise?: Promise<CryptoKey>

  /** 已处理过的 nonce（防重放） */
  private seenNonces = new Map<string, number>()

  /** 是否已向中继页发送过 hello */
  private announced = false

  /** 握手过程中的 Promise（防并发） */
  private handshakePromise: Promise<void> | null = null

  /** 当前 Bridge 实例的客户端 ID */
  private readonly clientId = crypto.randomUUID()

  constructor(private options: IframeBridgeOptions) {
    /** 监听 postMessage 消息 */
    window.addEventListener('message', this.handleWindowMessage)

    /** 页面卸载时释放资源 */
    window.addEventListener('beforeunload', () => this.destroy())
  }

  // ================== Init ==================

  /** 懒加载 iframe，只会执行一次 */
  async init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise

    /** 初始化 BroadcastChannel（同域多页面通信） */
    this.broadcast = new BroadcastChannel(this.options.channelName)
    this.broadcast.addEventListener('message', this.handleBroadcastMessage)

    this.readyPromise = new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe')
      iframe.src = this.options.bridgeUrl
      iframe.loading = 'eager'
      iframe.hidden = true

      /** 最小 sandbox 权限 */
      iframe.sandbox.add('allow-scripts', 'allow-same-origin')

      /** 扩展 sandbox 权限 */
      this.options.sandboxPermissions?.forEach((p) =>
        iframe.sandbox.add(p as DOMTokenList['value'])
      )

      iframe.onload = () => {
        this.iframe = iframe
        this.announced = false
        resolve()

        /** iframe 加载完成后立即尝试握手 */
        void this.ensureHandshake()
      }

      iframe.onerror = (e) => {
        iframe.remove()
        reject(e)
      }

      document.body.appendChild(iframe)
    })

    return this.readyPromise
  }

  // ================== Send ==================

  /** 发送消息（iframe + BroadcastChannel 双通道） */
  async send(
    type: string,
    payload: T,
    onSent?: (message: BridgeMessage<T>) => void
  ): Promise<BridgeMessage<T>> {
    await this.init()
    await this.ensureHandshake()

    const message = await this.buildMessage(type, payload)

    /** 跨域主通道 */
    this.iframe?.contentWindow?.postMessage(
      message,
      this.options.targetOrigin
    )

    /** 同域加速通道 */
    this.broadcast?.postMessage(message)

    onSent?.(message)
    return message
  }

  // ================== Subscribe ==================

  /** 注册消息监听 */
  onMessage(handler: BridgeHandler<T>): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** 销毁 Bridge，释放资源 */
  destroy() {
    this.broadcast?.close()
    this.broadcast = undefined

    this.iframe?.remove()
    this.iframe = undefined

    this.announced = false
    this.handshakePromise = null

    window.removeEventListener('message', this.handleWindowMessage)

    this.handlers.clear()
    this.seenNonces.clear()
  }

  // ================== Message Handlers ==================

  /** postMessage 消息入口 */
  private handleWindowMessage = async (
    event: MessageEvent<BridgeMessage<T>>
  ) => {
    /** 校验来源是否合法 */
    if (!this.isTrustedOrigin(event.origin)) return

    console.log('✅ 收到 postMessage 消息:', event)
    await this.processMessage(event.data)
  }

  /** BroadcastChannel 消息入口 */
  private handleBroadcastMessage = async (
    event: MessageEvent<BridgeMessage<T>>
  ) => {
    await this.processMessage(event.data)
  }

  /** 统一消息处理管线 */
  private async processMessage(message: BridgeMessage<T>) {
    /** 防重放校验 */
    if (!this.verifyNonce(message)) return

    /** HMAC 签名校验 */
    if (!(await this.verifySignature(message))) return

    console.log('✅ 校验通过:', message)

    /** 持久化快照 */
    this.persistSnapshot(message)

    /** 分发给业务监听器 */
    this.handlers.forEach((h) => h(message))
  }

  /** 判断 postMessage 来源是否可信 */
  private isTrustedOrigin(origin: string) {
    return this.options.allowedOrigins.includes(origin)
  }

  // ================== Crypto ==================

  /** 获取 HMAC CryptoKey（懒加载） */
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

  /** 生成签名用的稳定字符串 */
  private serializeForSign(message: BridgeMessage<T>) {
    return `${message.type}|${message.timestamp}|${message.nonce}|${JSON.stringify(
      message.payload
    )}`
  }


  /**
   * ======================================================================
   * 生成消息 HMAC 签名
   * ======================================================================
   *
   * - 使用 Web Crypto API（非自实现加密逻辑）
   * - 通过共享密钥生成不可伪造的消息摘要
   * - 输出为 hex 字符串，便于跨端传输
   */
  private async createSignature(message: BridgeMessage<T>): Promise<string> {
    // 获取（或复用）HMAC CryptoKey
    const key = await this.getCryptoKey()

    // 将待签名内容编码为 Uint8Array
    const data = encoder.encode(this.serializeForSign(message))

    // 使用 HMAC-SHA256 进行签名
    const sig = await crypto.subtle.sign('HMAC', key, data)

    // 将签名结果转为 hex 字符串，作为可传输格式
    return [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }


  /**
   * ======================================================================
   * 校验消息 HMAC 签名
   * ======================================================================
   *
   * - 使用与 createSignature 完全一致的序列化规则
   * - 只要任意字段被篡改，校验都会失败
   * - 是 Bridge 判断消息是否可信的核心依据之一
   */
  private async verifySignature(message: BridgeMessage<T>): Promise<boolean> {
    // 缺少签名，直接视为非法消息
    if (!message.signature) return false

    // 获取（或复用）HMAC CryptoKey
    const key = await this.getCryptoKey()

    // 使用同一套序列化规则生成待校验数据
    const data = encoder.encode(this.serializeForSign(message))

    // 将 hex 字符串还原为 Uint8Array
    const bytes =
      message.signature.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []

    if (!bytes.length) return false

    // 使用 Web Crypto API 校验签名合法性
    return crypto.subtle.verify('HMAC', key, new Uint8Array(bytes), data)
  }

  // ================== Snapshot ==================

  /** 将最新合法消息持久化到 localStorage */
  private persistSnapshot(message: BridgeMessage<T>) {
    if (!this.options.storageKey) return
    try {
      localStorage.setItem(this.options.storageKey, JSON.stringify(message))

      /** 通知外部监听（如 DevTools / 状态恢复） */
      window.dispatchEvent(
        new CustomEvent<BridgeSnapshotEventDetail<T>>(BRIDGE_SNAPSHOT_EVENT, {
          detail: {
            key: this.options.storageKey,
            value: message,
          },
        })
      )
    } catch (error) {
      console.warn('[IframeBridge] Failed to persist snapshot', error)
    }
  }

  // ================== Handshake ==================

  /** 确保已向中继页发送 hello */
  private async ensureHandshake() {
    if (this.announced) return

    if (this.handshakePromise) {
      await this.handshakePromise
      return
    }

    this.handshakePromise = (async () => {
      const hello = await this.buildMessage('bridge:hello', {
        clientId: this.clientId,
      } as T)

      this.iframe?.contentWindow?.postMessage(
        hello,
        this.options.targetOrigin
      )

      this.announced = true
    })().finally(() => {
      this.handshakePromise = null
    })

    await this.handshakePromise
  }

  // ================== Replay Protection ==================

  /** timestamp + nonce 防重放校验 */
  private verifyNonce(message: BridgeMessage<T>): boolean {
    const windowMs = this.options.replayWindowMs ?? 15_000
    const now = Date.now()

    if (now - message.timestamp > windowMs) return false
    if (this.seenNonces.has(message.nonce)) return false

    this.seenNonces.set(message.nonce, message.timestamp)

    /** 清理过期 nonce */
    for (const [nonce, ts] of this.seenNonces) {
      if (now - ts > windowMs) {
        this.seenNonces.delete(nonce)
      }
    }

    return true
  }

  // ================== Builder ==================

  /** 构建并签名一条完整 BridgeMessage */
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
      sourceId: this.clientId,
    }

    message.signature = await this.createSignature(message)
    return message
  }
}