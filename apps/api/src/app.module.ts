import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { GatewaysModule } from './gateways/gateways.module';
import { HealthModule } from './health/health.module';

/**
 * Root module.
 *
 * Service modules from docs/ARCHITECTURE.md land here as their tasks
 * complete: Gateway (VG-005/006), Integration (VG-009+), Orchestrator,
 * and AI Session (VG-019).
 *
 * `AuthModule` registers a global guard, so importing it protects every
 * route in the application — including ones added by those later modules,
 * unless they opt out with `@Public()`.
 */
@Module({
  imports: [DatabaseModule, AuthModule, HealthModule, GatewaysModule],
})
export class AppModule {}
