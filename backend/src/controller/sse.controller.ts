import { Body, Controller, Get, Inject, Post, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { MessageService } from '../service/message.service';
import { randomUUID } from 'crypto';

interface SseClient {
  id: string;
  ctx: Context;
}

@Controller('/api/sse')
export class SseController {
  @Inject()
  ctx: Context;

  @Inject()
  messageService: MessageService;

  private clients = new Map<string, SseClient>();

  @Get('/stream')
  async stream() {
    // Long-lived SSE connection; store ctx so后续 broadcast 可直接写 response。
    const id = randomUUID();
    const ctx = this.ctx;
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.status = 200;
    ctx.res.flushHeaders?.();
    ctx.res.write(':ok\n\n');

    this.clients.set(id, { id, ctx });

    ctx.req.on('close', () => {
      this.clients.delete(id);
    });
  }

  @Post('/message')
  async push(@Body() body: Record<string, unknown>) {
    const saved = await this.messageService.recordInbound('sse', body);
    this.broadcast('message', saved);
    return { ok: true };
  }

  @Get('/messages')
  async list(@Query('limit') limit = 5) {
    const num = Number(limit) || 5;
    return this.messageService.recent(num);
  }

  @Get('/broadcast/test')
  async testBroadcast() {
    const payload = { ts: Date.now(), body: 'sse:test' };
    this.broadcast('message', payload);
    return { ok: true };
  }

  broadcast(event: string, data: unknown) {
    // text/event-stream 协议格式：event + data + 空行
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach(({ ctx }) => ctx.res.write(payload));
  }
}
