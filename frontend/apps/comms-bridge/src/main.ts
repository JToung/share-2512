/* ========================================================================
 * Secure Bridge —— 跨域通信的唯一中继页
 * ========================================================================
 *
 * 这是一个「强约束」的 iframe Bridge 实现，而不是简单的消息转发页。
 *
 * 架构铁律：
 * 1️⃣ Bridge 是 Client → Client 通信的唯一可信入口
 * 2️⃣ Bridge 是唯一允许使用 BroadcastChannel 的角色
 * 3️⃣ Client 永远不参与广播，避免 a → b → c 的级联回流
 * 4️⃣ 所有消息必须通过 timestamp + nonce + HMAC 的完整校验
 *
 * 目标：
 * - 在跨域环境下仍然保持清晰的通信拓扑
 * - 消除回环、风暴、伪造消息的可能性
 * - 让「通信秩序」成为代码的一部分
 */

/* ========================================================================
 * 消息 Envelope（通信协议定义）
 * ========================================================================
 * 所有 Client ↔ Bridge 通信都必须使用该结构。
 * 不符合该结构的消息，视为非法输入。
 */
interface BridgeMessage<T = unknown> {
  /** 消息唯一标识，用于日志、调试与链路追踪 */
  id: string
  /** 消息类型，如 bridge:hello / bridge:ack / business:event */
  type: string
  /** 实际承载的业务数据 */
  payload: T
  /** 发送时间戳（毫秒），用于防止过期 / 未来消息 */
  timestamp: number
  /** 一次性随机数，用于防止重放攻击 */
  nonce: string
  /** HMAC 校验签名（hex 字符串） */
  signature: string
  /** 发起消息的 clientId（用于 fan-out 时避免回发） */
  sourceId: string
}

/* ========================================================================
 * 已注册 Client 的内部描述
 * ========================================================================
 */
interface ClientInfo {
  /** Client 唯一标识 */
  id: string
  /** Client 所在 origin（用于严格匹配校验） */
  origin: string
  /** Client 页面对应的 window 引用 */
  window: Window
  /** 最近一次成功通信时间（用于生命周期管理） */
  lastSeen: number
}

/* ========================================================================
 * Bridge 基础配置
 * ========================================================================
 */

/**
 * ✅ 允许接入 Bridge 的 origin 白名单
 * - 所有不在该列表中的 postMessage 会被立即拒绝
 * - 这是跨域通信的第一道安全边界
 */
const allowedOrigins = new Set([
  'https://signal-hub.xxx.com',
  'https://signal-viewer.xxx.com',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
])

/**
 * ✅ Bridge 内部唯一的广播通道
 * - BroadcastChannel 只能同源
 * - 因此只允许存在于 Bridge 页面中
 * - Client 永远无法直接访问
 */
const broadcastChannel = new BroadcastChannel('signal-sync-bridge')

/**
 * ✅ 已完成握手的 Client 注册表
 * key: clientId
 * value: ClientInfo
 */
const clients = new Map<string, ClientInfo>()

/**
 * ✅ 已使用过的 nonce 集合
 * - 防止消息被重放
 * - nonce 只在 replayWindowMs 时间窗口内有效
 */
const seenNonces = new Set<string>()

/** HMAC 计算使用的文本编码器 */
const encoder = new TextEncoder()

/**
 * ⚠️ 示例用共享密钥
 * - 实际生产环境应通过安全配置下发
 * - Client 与 Bridge 必须保持一致
 */
const hmacSecret = 'demo-shared-secret'

/**
 * ✅ 最大允许的时间偏移（毫秒）
 * - 用于校验 timestamp
 * - 同时也是 nonce 的生命周期
 */
const replayWindowMs = 15_000

/** CryptoKey 缓存，避免重复 importKey 带来的性能损耗 */
let cryptoKeyPromise: Promise<CryptoKey> | null = null

/* ========================================================================
 * Client ↔ Bridge 握手机制
 * ========================================================================
 *
 * Client 页面在启动后，必须首先发送：
 *   type: 'bridge:hello'
 *   payload: { clientId }
 *
 * 只有握手成功的 Client，才被允许发送业务消息。
 */
async function handshake(event: MessageEvent<BridgeMessage>) {
  if (!event.source) return

  const { clientId } = (event.data.payload ?? {}) as { clientId?: string }
  if (!clientId) {
    console.warn('❌ 握手失败：缺少 clientId')
    return
  }

  /**
   * 注册 Client：
   * - 保存 window 引用，用于后续 fan-out
   * - 固定 origin，防止冒充
   */
  const info: ClientInfo = {
    id: clientId,
    origin: event.origin,
    window: event.source as Window,
    lastSeen: Date.now(),
  }

  clients.set(clientId, info)
  console.log('✅ Client 注册完成:', clientId)

  /**
   * 返回 ACK，表示握手成功
   * Client 收到该消息后，才可发送业务事件
   */
  const ack = await sign({
    type: 'bridge:ack',
    payload: { clientId },
    sourceId: 'bridge',
  })

  info.window.postMessage(ack, info.origin)
}

/* ========================================================================
 * Client → Bridge 的唯一入口
 * ========================================================================
 *
 * ⚠️ 所有 postMessage 只能从这里进入系统
 * ⚠️ 这是唯一允许进入 BroadcastChannel 的地方
 */
async function handleIncomingMessage(event: MessageEvent<BridgeMessage>) {
  // 第一层防线：window + origin 校验
  if (!event.source || !allowedOrigins.has(event.origin)) {
    console.warn('❌ 拒绝非法来源:', event.origin)
    return
  }

  const msg = event.data

  // 第二层防线：完整安全校验
  if (
    !verifyTimestamp(msg) ||
    !verifyNonce(msg) ||
    !(await verifySignature(msg))
  ) {
    console.warn('❌ 消息安全校验失败:', msg)
    return
  }

  // 握手消息单独处理
  if (msg.type === 'bridge:hello') {
    await handshake(event)
    return
  }

  /**
   * 非握手消息必须：
   * - 已完成注册
   * - sourceId 与 origin 严格匹配
   */
  const client = clients.get(msg.sourceId)
  if (!client || client.origin !== event.origin) {
    console.warn('❌ 未注册 Client 或 origin 不匹配:', msg.sourceId)
    return
  }

  // 更新最近活跃时间
  client.lastSeen = Date.now()

  /**
   * ⭐ Bridge 唯一广播入口 ⭐
   *
   * 所有合法业务消息只在这里进入 BroadcastChannel
   * Client 永远没有广播权限
   */
  broadcastChannel.postMessage(msg)
}

/* ========================================================================
 * Bridge 内部广播 → Client fan-out
 * ========================================================================
 *
 * BroadcastChannel 中的消息会被分发给：
 * - 所有已注册 Client
 * - 排除 sourceId 自身，防止回声
 */
broadcastChannel.addEventListener('message', (event) => {
  const msg = event.data as BridgeMessage

  clients.forEach((client, clientId) => {
    if (clientId === msg.sourceId) return

    try {
      client.window.postMessage(msg, client.origin)
    } catch {
      // window 已失效，直接清理
      clients.delete(clientId)
    }
  })
})

/* ========================================================================
 * window 消息监听入口
 * ========================================================================
 */
window.addEventListener('message', (event) => {
  void handleIncomingMessage(event)
})

/* ========================================================================
 * Client 生命周期管理
 * ========================================================================
 *
 * 定期清理长期不活跃的 Client，防止 window 引用泄漏
 */
function pruneClients() {
  const now = Date.now()
  for (const [id, client] of clients) {
    if (now - client.lastSeen > 60 * 60 * 1000) {
      clients.delete(id)
    }
  }
}

window.setInterval(pruneClients, 30_000)

window.addEventListener('beforeunload', () => {
  broadcastChannel.close()
  clients.clear()
})

/* ========================================================================
 * 安全校验函数
 * ========================================================================
 */

/** 校验时间戳：防止过期或未来消息 */
function verifyTimestamp(msg: BridgeMessage) {
  return Math.abs(Date.now() - msg.timestamp) <= replayWindowMs
}

/** 校验 nonce：防止消息重放 */
function verifyNonce(msg: BridgeMessage) {
  if (seenNonces.has(msg.nonce)) return false
  seenNonces.add(msg.nonce)
  setTimeout(() => seenNonces.delete(msg.nonce), replayWindowMs)
  return true
}

/** 校验 HMAC 签名：防止伪造与篡改 */
async function verifySignature(msg: BridgeMessage) {
  const key = await getCryptoKey()
  const payload = encoder.encode(
    `${msg.type}|${msg.timestamp}|${msg.nonce}|${JSON.stringify(msg.payload)}`
  )

  const sig = Uint8Array.from(
    msg.signature.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || []
  )

  return crypto.subtle.verify('HMAC', key, sig, payload)
}

/* ========================================================================
 * Bridge 自发消息签名
 * ========================================================================
 */
async function sign(
  partial: Omit<BridgeMessage, 'id' | 'timestamp' | 'nonce' | 'signature'>
) {
  const msg: BridgeMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
    signature: '',
    ...partial,
  }

  const key = await getCryptoKey()
  const payload = encoder.encode(
    `${msg.type}|${msg.timestamp}|${msg.nonce}|${JSON.stringify(msg.payload)}`
  )

  const sig = await crypto.subtle.sign('HMAC', key, payload)
  msg.signature = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return msg
}

/* ========================================================================
 * HMAC CryptoKey 获取与缓存
 * ========================================================================
 */
function getCryptoKey() {
  if (!cryptoKeyPromise) {
    cryptoKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(hmacSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
  }
  return cryptoKeyPromise
}