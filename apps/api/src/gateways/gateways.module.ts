import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { GATEWAY_SESSION_CONFIG } from './gateways.constants';
import { GatewaySecretService } from './gateway-secret.service';
import { GatewaysController } from './gateways.controller';
import { GatewaysService } from './gateways.service';
import { loadGatewaySessionConfig } from './session/gateway-session.config';
import { GatewaySessionServer } from './session/gateway-session.server';
import { GatewaySessionService } from './session/gateway-session.service';

/**
 * Gateway registration, claim (VG-005), and the session transport (VG-006).
 *
 * The session server is a provider rather than a Nest WebSocket gateway,
 * because it authenticates during the HTTP upgrade; `configureApp` attaches
 * it to the running server.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [GatewaysController],
  providers: [
    { provide: GATEWAY_SESSION_CONFIG, useFactory: () => loadGatewaySessionConfig() },
    GatewaysService,
    GatewaySecretService,
    GatewaySessionService,
    GatewaySessionServer,
  ],
  exports: [GatewaysService, GatewaySecretService, GatewaySessionService, GatewaySessionServer],
})
export class GatewaysModule {}
