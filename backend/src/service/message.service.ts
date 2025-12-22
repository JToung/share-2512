import { Inject, Init, Provide } from '@midwayjs/core'
import { MongooseDataSourceManager } from '@midwayjs/mongoose'
import type { Connection, Model } from 'mongoose'
import {
  Message,
  MessageDocument,
  MessageSchema,
  MessageChannel,
  MessageDirection,
} from '../entity/Message'

/**
 * 消息记录服务
 * - 统一封装 MongoDB CRUD
 * - 用于 SSE / WS / HTTP 等多通道消息审计
 */
@Provide()
export class MessageService {
  @Inject()
  protected readonly mongooseDataSourceManager: MongooseDataSourceManager

  protected connection!: Connection
  protected messageModel!: Model<MessageDocument>

  @Init()
  async initModel() {
    this.connection =
      this.mongooseDataSourceManager.getDataSource('default')

    if (!this.connection) {
      throw new Error(
        '[MessageService] Mongoose data source "default" is not initialized'
      )
    }

    this.messageModel =
      (this.connection.models.Message as Model<MessageDocument>) ??
      (this.connection.model('Message', MessageSchema) as Model<MessageDocument>)
  }

  // =========================
  // 基础 CRUD
  // =========================

  /** 创建消息记录 */
  async create(payload: Partial<Message>): Promise<MessageDocument> {
    return this.messageModel.create(payload)
  }

  /** 根据条件查询 */
  async find(
    filter: Partial<Message>,
    options?: {
      limit?: number
      sort?: Record<string, 1 | -1>
      lean?: boolean
    }
  ) {
    const { limit = 20, sort = { createdAt: -1 }, lean = true } =
      options ?? {}

    const query = this.messageModel.find(filter).sort(sort).limit(limit)
    return lean ? query.lean().exec() : query.exec()
  }

  /** 查询最近消息（调试 / Poll） */
  async recent(limit = 20) {
    return this.find({}, { limit })
  }

  // =========================
  // 语义化记录方法
  // =========================

  /** 记录进入后端的消息 */
  async recordInbound(
    type: string,
    payload: Record<string, unknown>,
    channel: MessageChannel = MessageChannel.SSE
  ) {
    return this.create({
      type,
      payload,
      direction: MessageDirection.INBOUND,
      channel,
    })
  }

  /** 记录向外广播的消息 */
  async recordOutbound(
    type: string,
    payload: Record<string, unknown>,
    channel: MessageChannel = MessageChannel.WS
  ) {
    return this.create({
      type,
      payload,
      direction: MessageDirection.OUTBOUND,
      channel,
    })
  }

  // =========================
  // 运维 / 清理
  // =========================

  /** 按时间清理历史消息（防止集合无限增长） */
  async cleanupBefore(date: Date): Promise<void> {
    await this.messageModel.deleteMany({
      createdAt: { $lt: date },
    })
  }
}
