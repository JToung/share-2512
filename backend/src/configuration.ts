import { Configuration } from '@midwayjs/core';
import * as crossDomain from '@midwayjs/cross-domain';
import * as koa from '@midwayjs/koa';
import * as mongoose from '@midwayjs/mongoose';
import * as ws from '@midwayjs/ws';
import { join } from 'path';

@Configuration({
  imports: [koa, mongoose, ws, crossDomain],
  importConfigs: [join(__dirname, './config')],
})
export class ContainerConfiguration {}
