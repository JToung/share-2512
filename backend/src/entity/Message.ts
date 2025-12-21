import { Document } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@midwayjs/mongoose';

@Schema({ collection: 'messages', timestamps: true })
export class Message {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  direction: 'inbound' | 'outbound';

  @Prop({ type: Object })
  payload: Record<string, unknown>;

  @Prop()
  channel: 'sse' | 'ws' | 'http' | 'broadcast';
}

export const MessageModel = SchemaFactory.createForClass(Message);
export type MessageDocument = Message & Document;
