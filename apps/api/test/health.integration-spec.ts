import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';
import { SERVICE_NAME } from '../src/health/health.service';

/**
 * The application now depends on the database, so AppModule is booted with a
 * stubbed PrismaService. That keeps liveness and readiness coverage running
 * everywhere, including without a database; the real driver and schema are
 * exercised by database.integration-spec.ts.
 */
describe('health endpoints (integration)', () => {
  let app: INestApplication;
  let isReachable: jest.Mock<Promise<boolean>, []>;

  beforeAll(async () => {
    isReachable = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        isReachable,
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    // Uses the same configuration as production bootstrap, so a global
    // pipe with a missing runtime dependency fails here rather than at
    // deploy time.
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/health', () => {
    it('returns 200 with the health payload', async () => {
      const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

      expect(response.body).toMatchObject({ status: 'ok', service: SERVICE_NAME });
      expect(typeof response.body.uptimeSeconds).toBe('number');
    });

    it('serves health only under the versioned prefix', async () => {
      await request(app.getHttpServer()).get('/health').expect(404);
    });

    it('returns 404 for an unknown route under the prefix', async () => {
      await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
    });

    it('stays up even when the database is unreachable', async () => {
      isReachable.mockResolvedValue(false);

      await request(app.getHttpServer()).get('/v1/health').expect(200);
    });
  });

  describe('GET /v1/health/ready', () => {
    it('returns 200 and ready when the database is up', async () => {
      isReachable.mockResolvedValue(true);

      const response = await request(app.getHttpServer()).get('/v1/health/ready').expect(200);

      expect(response.body).toEqual({
        status: 'ready',
        service: SERVICE_NAME,
        checks: { database: 'up' },
      });
    });

    it('returns 503 and not_ready when the database is down', async () => {
      isReachable.mockResolvedValue(false);

      const response = await request(app.getHttpServer()).get('/v1/health/ready').expect(503);

      expect(response.body).toEqual({
        status: 'not_ready',
        service: SERVICE_NAME,
        checks: { database: 'down' },
      });
    });

    it('does not leak connection detail when the database is down', async () => {
      isReachable.mockResolvedValue(false);

      const response = await request(app.getHttpServer()).get('/v1/health/ready').expect(503);

      expect(JSON.stringify(response.body)).not.toMatch(/postgres|password|5432|ECONNREFUSED/i);
    });
  });
});
