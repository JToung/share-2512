import { Body, Controller, Get, Inject, Post, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { randomUUID } from 'crypto';
import { MessageService } from '../service/message.service';

interface SseClient {
  id: string;
  ctx: Context;
}

/**
 * SSE 控制器：负责管理长连接、入站推送、以及 HTTP 轮询补偿数据。
 */
@Controller('/api/sse')
export class SseController {
  @Inject()
  ctx: Context;

  @Inject()
  messageService: MessageService;

  /** 维护所有在线 SSE 客户端，key 为随机连接 ID。 */
  private clients = new Map<string, SseClient>();

  @Get('/stream')
  async stream() {
    // 建立 SSE 长连接，保存 ctx 以便后续直接写入响应。
    const id = randomUUID();
    const ctx = this.ctx;
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.status = 200;
    ctx.res.flushHeaders?.();
    ctx.res.write(':ok\n\n');

    this.clients.set(id, { id, ctx });

    // 连接断开时清理引用，避免内存泄露。
    ctx.req.on('close', () => {
      this.clients.delete(id);
    });
  }

  @Post('/message')
  async push(@Body() body: Record<string, unknown>) {
    // 将消息记入 Mongo，随后广播给所有在线 SSE 客户端。
    const saved = await this.messageService.recordInbound('sse', body);
    this.broadcast('message', saved);
    return { ok: true };
  }

  @Get('/messages')
  async list(@Query('limit') limit = 5) {
    // 供 HTTP Poll 使用的兜底接口，默认取最新 5 条。
    const num = Number(limit) || 5;
    return this.messageService.recent(num);
  }

  @Get('/broadcast/test')
  async testBroadcast() {
    // 方便分享演示：直接触发一次虚拟推送。
    const payload = { ts: Date.now(), body: 'sse:test' };
    this.broadcast('message', payload);
    return { ok: true };
  }

  broadcast(event: string, data: unknown) {
    // text/event-stream 协议格式为 event + data + 空行。
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach(({ ctx }) => ctx.res.write(payload));
  }
}
