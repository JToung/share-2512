import { Inject, Logger } from '@midwayjs/core';
import { OnWSConnection, OnWSClose, OnWSMessage, WebSocketController, WS } from '@midwayjs/ws';
import { ILogger } from '@midwayjs/logger';
import { MessageService } from '../service/message.service';

interface BroadcastPayload {
  type: string;
  body: unknown;
}

@WebSocketController('/ws/signal-hub')
export class WsGateway {
  @Inject()
  messageService: MessageService;

  @Logger()
  logger: ILogger;

  private clients = new Set<WS>();

  @OnWSConnection()
  async onConnection(socket: WS) {
    this.clients.add(socket);
    socket.send(JSON.stringify({ type: 'welcome', ts: Date.now() }));
    this.logger.info('[ws] client connected');
  }

  @OnWSMessage('message')
  async onMessage(socket: WS, payload: BroadcastPayload) {
    await this.messageService.recordOutbound(payload.type, payload as Record<string, unknown>);
    this.broadcast({ ...payload, ts: Date.now() });
  }

  @OnWSClose()
  async onClose(socket: WS) {
    this.clients.delete(socket);
    this.logger.info('[ws] client closed');
  }

  broadcast(payload: BroadcastPayload & { ts?: number }) {
    // Fan-out to every online WebSocket client, used by WS + HTTP fallback。
    const message = JSON.stringify(payload);
    this.clients.forEach((client) => client.send(message));
  }
}
