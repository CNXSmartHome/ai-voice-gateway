import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { GatewaysModule } from './gateways/gateways.module';
import { HealthModule } from './health/health.module';
import { PropertiesModule } from './properties/properties.module';
import { ServiceRequestsModule } from './service-requests/service-requests.module';

/**
 * Root module.
 *
 * `AuthModule` registers a global guard, so importing it protects every route
 * unless a route explicitly opts out with `@Public()`.
 *
 * Smart Villa domains are added as modules rather than folded into the voice
 * transport layer. This keeps guest, voice and staff entry points able to
 * share one authoritative workflow service.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HealthModule,
    PropertiesModule,
    GatewaysModule,
    ServiceRequestsModule,
  ],
})
export class AppModule {}
