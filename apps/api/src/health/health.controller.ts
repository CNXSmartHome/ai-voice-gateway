import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import { HealthService, type HealthStatus, type ReadinessStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: the process is up. Never touches a dependency. */
  @Get()
  check(): HealthStatus {
    return this.healthService.getStatus();
  }

  /**
   * Readiness: this instance can serve traffic.
   *
   * Returns 503 when a dependency is down, so an orchestrator or load
   * balancer removes the instance rather than sending it requests it
   * cannot serve. The body is returned either way for diagnosis.
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessStatus> {
    const readiness = await this.healthService.getReadiness();

    if (readiness.status !== 'ready') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return readiness;
  }
}
