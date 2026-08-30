import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { GatewaysController } from './gateways.controller';
import { GatewaysService } from './gateways.service';

/**
 * Gateway registration and claim (VG-005).
 *
 * The WebSocket session, heartbeat, and device authentication described for
 * the Gateway Service in docs/ARCHITECTURE.md arrive with VG-006.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [GatewaysController],
  providers: [GatewaysService],
  exports: [GatewaysService],
})
export class GatewaysModule {}
