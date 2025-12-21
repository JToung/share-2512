import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from '../entity/Message';

@Provide()
export class MessageService {
  @InjectEntityModel(Message)
  messageModel: Model<MessageDocument>;

  async create(payload: Partial<Message>): Promise<MessageDocument> {
    const doc = new this.messageModel(payload);
    return doc.save();
  }

  async recent(limit = 20) {
    return this.messageModel.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  async recordInbound(type: string, payload: Record<string, unknown>) {
    return this.create({ type, payload, direction: 'inbound', channel: 'sse' });
  }

  async recordOutbound(type: string, payload: Record<string, unknown>) {
    return this.create({ type, payload, direction: 'outbound', channel: 'ws' });
  }
}
