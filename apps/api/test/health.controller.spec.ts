import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';

import { PrismaService } from '../src/database/prisma.service';
import { HealthController } from '../src/health/health.controller';
import { HealthService, SERVICE_NAME } from '../src/health/health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let isReachable: jest.Mock<Promise<boolean>, []>;

  /** Captures the status code the controller sets, without a real server. */
  function responseStub(): { response: Response; statusCode: number | null } {
    const captured = { response: null as unknown as Response, statusCode: null as number | null };
    captured.response = {
      status(code: number) {
        captured.statusCode = code;
        return this;
      },
    } as unknown as Response;
    return captured;
  }

  beforeEach(async () => {
    isReachable = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService, { provide: PrismaService, useValue: { isReachable } }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('liveness', () => {
    it('reports ok with service identity', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
      expect(result.service).toBe(SERVICE_NAME);
      expect(typeof result.version).toBe('string');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.uptimeSeconds)).toBe(true);
    });

    it('does not leak environment or dependency detail', () => {
      const keys = Object.keys(controller.check()).sort();

      expect(keys).toEqual(['service', 'status', 'uptimeSeconds', 'version']);
    });

    it('does not consult the database', () => {
      controller.check();

      expect(isReachable).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reports ready when the database is reachable', async () => {
      const captured = responseStub();

      const result = await controller.ready(captured.response);

      expect(result).toEqual({
        status: 'ready',
        service: SERVICE_NAME,
        checks: { database: 'up' },
      });
      expect(captured.statusCode).toBeNull();
    });

    it('returns 503 when the database is unreachable', async () => {
      isReachable.mockResolvedValue(false);
      const captured = responseStub();

      const result = await controller.ready(captured.response);

      expect(result).toEqual({
        status: 'not_ready',
        service: SERVICE_NAME,
        checks: { database: 'down' },
      });
      expect(captured.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('reports reachability without leaking connection detail', async () => {
      isReachable.mockResolvedValue(false);

      const body = JSON.stringify(await controller.ready(responseStub().response));

      expect(body).not.toMatch(/postgres|password|@|5432|ECONNREFUSED/i);
    });
  });
});
