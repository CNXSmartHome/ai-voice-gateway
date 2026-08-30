import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { SERVICE_NAME } from '../src/health/health.service';

describe('GET /v1/health (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // Uses the same configuration as production bootstrap, so a global
    // pipe with a missing runtime dependency fails here rather than at
    // deploy time.
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

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
});
