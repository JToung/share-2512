import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { MessageService } from '../service/message.service';
import { WsGateway } from '../websocket/gateway';

/**
 * 提供一个 HTTP -> WebSocket 的轻量入口，方便外部服务或管理台通过 HTTP 推送消息。
 */
@Controller('/api/ws')
export class WsController {
  @Inject()
  gateway: WsGateway;

  @Inject()
  messageService: MessageService;

  @Post('/message')
  async send(@Body() body: Record<string, unknown>) {
    // 入库记录，随后复用网关进行广播，保持与 WS 直连同一条链路。
    await this.messageService.recordInbound('api-ws', body);
    this.gateway.broadcast({ type: 'api-ws', body });
    return { ok: true };
  }
}
