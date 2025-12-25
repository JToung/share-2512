import WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { Inject, OnWSConnection, OnWSMessage, WSController } from '@midwayjs/core';
import { WsClientRegistry } from '../service/ws-client-registry';

interface BroadcastPayload extends Record<string, unknown> {
  type: string;
  body: unknown;
  targetApp?: string | string[];
}

/**
 * WebSocket 网关：负责维护所有在线连接，并处理消息广播/落库。
 */
@WSController('/ws/signal-hub')
export class WsGateway {
  @Inject()
  // 全局注册表，用于跨实例共享在线连接
  clientRegistry: WsClientRegistry;

  @OnWSConnection()
  async onConnection(socket: WebSocket, request: IncomingMessage) {
    // 通过 querystring 中的 client 参数识别来源平台
    const url = new URL(request.url ?? '', `http://${request.headers.host}`);
    const appId = url.searchParams.get('client') ?? 'unknown';

    // 新连接建立后放入注册表
    this.clientRegistry.add(socket, { appId });

    socket.on('close', () => {
      // 断开时及时清理，避免内存泄漏
      this.clientRegistry.remove(socket);
    });
  }

  @OnWSMessage('message')
  async onMessage(data: WebSocket.RawData) {
    // 所有消息统一解析并转发给广播逻辑
    const payload = JSON.parse(data.toString());
    this.broadcast({ ...payload, ts: Date.now() });
  }

  broadcast(payload: BroadcastPayload & { ts?: number }) {
    // 扫描所有客户端，筛选出目标 app
    this.clientRegistry.forEach((client, meta) => {
      if (
        payload.targetApp &&
        ![].concat(payload.targetApp as any).includes(meta.appId)
      ) {
        return;
      }
      if (client.readyState === WebSocket.OPEN && payload.type !== 'heartbeat') {
        // 非心跳消息直接推送
        console.log('broadcast', meta);
        client.send(JSON.stringify(payload));
      }
    });
  }
}
