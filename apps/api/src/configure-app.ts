import type { Server as HttpServer } from 'node:http';

import { type INestApplication, ValidationPipe } from '@nestjs/common';

import { API_PREFIX } from './config/app-config';
import { GatewaySessionServer } from './gateways/session/gateway-session.server';

/**
 * Applies the global application configuration.
 *
 * Both `bootstrap()` and the integration tests call this, so a pipe or
 * prefix added here is always exercised by the test suite. Configuring
 * the two independently previously let a missing `ValidationPipe`
 * dependency pass tests and fail at startup.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);

  // Reject unknown fields rather than silently ignoring them, so a
  // malformed or hostile payload fails closed.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // The gateway session listens on the same HTTP server, upgrading requests
  // on its own path (VG-006). Attached here for the same reason as the pipe:
  // so tests exercise the wiring production uses, rather than a copy of it.
  app.get(GatewaySessionServer).attach(app.getHttpServer() as HttpServer);

  // Shutdown hooks let the session server close its sockets and settle each
  // gateway's status, instead of leaving a fleet reading ONLINE after a
  // deploy.
  app.enableShutdownHooks();

  return app;
}
