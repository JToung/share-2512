import { MidwayConfig } from '@midwayjs/core';

/**
 * MidwayJS 全局配置：集中管理密钥、端口、数据源以及 WS 路径。
 */
export default {
  keys: 'share-2512-demo',
  koa: {
    port: 7001,
  },
  cors: {
    allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS',
    allowHeaders: '*',
    credentials: true,
    origin: (req: { headers?: Record<string, string> }) => {
      const allowed = ['http://localhost:4173', 'http://localhost:4174', 'http://localhost:4175'];
      const requestOrigin = req.headers?.origin;
      return requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
    },
  },
  mongoose: {
    dataSource: {
      default: {
        uri: 'mongodb://localhost:27017/share2512',
        options: {},
        entities: ['./entity/*.ts'],
      },
    },
  },
  ws: {
    // 与前端 signal-hub 应用的 WS 客户端路径保持一致。
    path: '/ws/signal-hub',
  },
} as MidwayConfig;
