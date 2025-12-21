import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { MessageService } from '../service/message.service';
import { WsGateway } from '../websocket/gateway';

@Controller('/api/ws')
export class WsController {
  @Inject()
  gateway: WsGateway;

  @Inject()
  messageService: MessageService;

  @Post('/message')
  async send(@Body() body: Record<string, unknown>) {
    await this.messageService.recordInbound('api-ws', body);
    this.gateway.broadcast({ type: 'api-ws', body });
    return { ok: true };
  }
}
