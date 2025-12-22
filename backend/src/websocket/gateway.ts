import type WebSocket from 'ws';
import { Inject, Logger, OnWSConnection, OnWSDisConnection, OnWSMessage, WSController } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { MessageService } from '../service/message.service';

interface BroadcastPayload extends Record<string, unknown> {
  type: string;
  body: unknown;
}

/**
 * WebSocket 网关：负责维护所有在线连接，并处理消息广播/落库。
 */
@WSController('/ws/signal-hub')
export class WsGateway {
  @Inject()
  messageService: MessageService;

  @Logger()
  logger: ILogger;

  /** 记录当前所有在线 socket，便于广播。 */
  private clients = new Set<WebSocket>();

  @OnWSConnection()
  async onConnection(socket: WebSocket) {
    this.clients.add(socket);
    // 握手成功后立即返回欢迎消息，方便前端检测链路状态。
    socket.send(JSON.stringify({ type: 'welcome', ts: Date.now() }));
    socket.on('close', () => this.clients.delete(socket));
    this.logger.info('[ws] client connected');
  }

  @OnWSMessage('message')
  async onMessage(socket: WebSocket, payload: BroadcastPayload) {
    // 每条上行消息都写入 Mongo，随后广播给所有客户端。
    await this.messageService.recordOutbound(payload.type, payload);
    this.broadcast({ ...payload, ts: Date.now() });
  }

  @OnWSDisConnection()
  async onClose(reason: number | string | Buffer) {
    this.logger.info('[ws] client closed', reason);
  }

  broadcast(payload: BroadcastPayload & { ts?: number }) {
    // Fan-out 到所有在线客户端，供 Signal Hub / Viewer 同步状态。
    const message = JSON.stringify(payload);
    this.clients.forEach((client) => client.send(message));
  }
}
