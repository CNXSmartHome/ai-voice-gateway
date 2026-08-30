import { type INestApplication, ValidationPipe } from '@nestjs/common';

import { API_PREFIX } from './config/app-config';

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

  return app;
}
