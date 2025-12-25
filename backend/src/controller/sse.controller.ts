import { Body, Controller, Get, Post, Query, Inject } from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
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
  messageService: MessageService;

  /** 维护所有在线 SSE 客户端 */
  private clients = new Map<string, SseClient>();

  private allowedOrigins = new Set([
    'http://localhost:4173',
    'http://localhost:4174',
    'http://localhost:4175',
    'http://localhost:10000',
  ]);

  // ================== SSE ==================

  @Get('/stream')
  async stream(ctx: Context) {
    if (!this.applyCors(ctx)) {
      ctx.status = 403;
      ctx.body = 'CORS forbidden';
      return;
    }

    const id = randomUUID();

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

  // ================== Push ==================

  @Post('/message')
  async push(ctx: Context, @Body() body: Record<string, unknown>) {
    if (!this.applyCors(ctx)) {
      ctx.status = 403;
      return { ok: false };
    }

    const saved = await this.messageService.recordInbound('sse', body);
    this.broadcast('message', saved);

    return { ok: true };
  }

  // ================== Poll ==================

  @Get('/messages')
  async list(ctx: Context, @Query('limit') limit = 5) {
    if (!this.applyCors(ctx)) {
      ctx.status = 403;
      return [];
    }

    const num = Number(limit) || 5;
    return this.messageService.recent(num);
  }

  // ================== Test ==================

  @Get('/broadcast/test')
  async testBroadcast(ctx: Context) {
    if (!this.applyCors(ctx)) {
      ctx.status = 403;
      return { ok: false };
    }

    const payload = { ts: Date.now(), body: 'sse:test' };
    this.broadcast('message', payload);

    return { ok: true };
  }

  // ================== Broadcast ==================

  broadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach(({ ctx }) => {
      ctx.res.write(payload);
    });
  }

  // ================== CORS ==================

  /** 从请求头中获取 Origin（唯一正确来源） */
  private getRequestOrigin(ctx: Context): string | null {
    return ctx.request.header.origin ?? null;
  }

  private normalizeOrigin(origin?: string | null) {
    return origin?.replace(/\/$/, '').toLowerCase();
  }

  private isOriginAllowed(origin?: string | null) {
    const normalized = this.normalizeOrigin(origin);
    if (!normalized) return false;

    for (const allowed of this.allowedOrigins) {
      if (this.normalizeOrigin(allowed) === normalized) {
        return true;
      }
    }
    return false;
  }

  /**
   * SSE / API 通用 CORS 处理
   * 规则：请求什么 Origin，就原样返回什么 Origin
   */
  private applyCors(ctx: Context): boolean {
    const origin = this.getRequestOrigin(ctx);
    if (!origin || !this.isOriginAllowed(origin)) {
      return false;
    }

    ctx.set('Access-Control-Allow-Origin', origin);
    ctx.set('Access-Control-Allow-Credentials', 'true');
    ctx.set('Vary', 'Origin');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type');
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    return true;
  }
}