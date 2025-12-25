/**
 * ================= Bridge 消息 Envelope =================
 * 所有跨系统通信必须遵循的统一消息结构
 */
export interface BridgeMessage<T = unknown> {
  id: string;          // 消息唯一 ID
  type: string;        // 消息类型（bridge:hello / 业务事件）
  payload: T;          // 消息体
  timestamp: number;   // 时间戳（用于防重放）
  nonce: string;       // 一次性随机值（用于防重放）
  signature: string;  // HMAC 签名
  sourceId: string;   // 发送方 clientId
}

/**
 * Bridge 内部维护的 Client 信息
 */
export interface ClientInfo {
  id: string;          // clientId
  origin: string;      // 来源 origin
  window: Window;      // postMessage 目标 window
  lastSeen: number;    // 最近一次活跃时间
}

/**
 * 日志方向（入站/出站）
 */
export type LogDirection = 'received' | 'sent';

/**
 * UI 日志条目结构（仅用于监控展示）
 */
export interface LogEntry {
  key: string;
  direction: LogDirection;
  message: BridgeMessage;
  detail: string;
  highlight: boolean;
  timestamp: number;
  json: string;
}
