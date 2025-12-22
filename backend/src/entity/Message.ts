import { Schema, type Document } from 'mongoose';

/**
 * 消息实体 Schema：定义 MongoDB 中消息记录的结构。
 */
export enum MessageDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum MessageChannel {
  SSE = 'sse',
  WS = 'ws',
  HTTP = 'http',
  BROADCAST = 'broadcast',
}

export interface Message {
  type: string;
  direction: MessageDirection;
  payload: Record<string, unknown>;
  channel: MessageChannel;
  createdAt?: Date;
  updatedAt?: Date;
}

export type MessageDocument = Message & Document;

export const MessageSchema = new Schema<Message>(
  {
    type: { type: String, required: true },
    direction: {
      type: String,
      enum: Object.values(MessageDirection),
      required: true,
    },
    payload: { type: Object },
    channel: { type: String, enum: Object.values(MessageChannel) },
  },
  {
    collection: 'messages',
    timestamps: true,
  }
);
