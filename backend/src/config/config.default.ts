import { MidwayConfig } from '@midwayjs/core';

export default {
  keys: 'share-2512-demo',
  koa: {
    port: 7001,
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
    path: '/ws',
  },
} as MidwayConfig;
