// src/service/ws-client-registry.ts
import WebSocket from 'ws';
import { Provide, Scope, ScopeEnum } from '@midwayjs/core';

interface ClientMeta {
  appId: string;
}

@Provide()
@Scope(ScopeEnum.Singleton)
export class WsClientRegistry {
  // 维护所有连接实例及其所属 appId
  private clients = new Map<WebSocket, ClientMeta>();

  add(socket: WebSocket, meta: ClientMeta) {
    // 新的 socket 接入时登记其元信息
    this.clients.set(socket, meta);
  }

  remove(socket: WebSocket) {
    // 连接关闭或失效时及时清理
    this.clients.delete(socket);
  }

  forEach(
    cb: (socket: WebSocket, meta: ClientMeta) => void
  ) {
    // 遍历当前所有在线客户端
    this.clients.forEach((meta, socket) => cb(socket, meta));
  }

  getAppIds() {
    // 获取当前所有在线的 appId 列表
    return Array.from(this.clients.values()).map(c => c.appId);
  }

  size() {
    // 返回当前在线连接数量
    return this.clients.size;
  }
}
