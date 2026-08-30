import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { loadAppConfig } from './config/app-config';
import { configureApp } from './configure-app';

export async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = configureApp(await NestFactory.create(AppModule));

  await app.listen(config.port, config.host);
  Logger.log(`API listening on ${config.host}:${config.port}/${config.apiPrefix}`, 'Bootstrap');
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    Logger.error('Failed to start API', error instanceof Error ? error.stack : error, 'Bootstrap');
    process.exitCode = 1;
  });
}
