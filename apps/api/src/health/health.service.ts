import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
}

export const SERVICE_NAME = 'ai-voice-gateway-api';

@Injectable()
export class HealthService {
  /**
   * Liveness payload. Deliberately free of environment detail, hostnames,
   * and dependency URLs so the endpoint can stay unauthenticated.
   *
   * Datastore readiness checks are added with those dependencies (VG-003).
   */
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
