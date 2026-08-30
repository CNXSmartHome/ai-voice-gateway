import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

export interface HealthStatus {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
}

export interface ReadinessStatus {
  readonly status: 'ready' | 'not_ready';
  readonly service: string;
  readonly checks: {
    readonly database: 'up' | 'down';
  };
}

export const SERVICE_NAME = 'ai-voice-gateway-api';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness payload. Deliberately free of environment detail, hostnames,
   * and dependency URLs so the endpoint can stay unauthenticated.
   *
   * Takes no dependency on the database: a process that is running but
   * cannot reach Postgres is alive and should not be restarted, only kept
   * out of the load balancer. That distinction is what `getReadiness`
   * reports.
   */
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /**
   * Readiness payload: can this instance actually serve traffic?
   *
   * Reports reachability only. No driver error text, host, or connection
   * string reaches the response body.
   */
  async getReadiness(): Promise<ReadinessStatus> {
    const databaseUp = await this.prisma.isReachable();

    return {
      status: databaseUp ? 'ready' : 'not_ready',
      service: SERVICE_NAME,
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
