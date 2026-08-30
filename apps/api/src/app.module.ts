import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

/**
 * Root module.
 *
 * Service modules from docs/ARCHITECTURE.md land here as their tasks
 * complete: Gateway (VG-005/006), Integration (VG-009+), Orchestrator,
 * and AI Session (VG-019).
 */
@Module({
  imports: [DatabaseModule, HealthModule],
})
export class AppModule {}
