import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_CONFIG } from '../src/auth/auth.constants';
import type { AuthConfig } from '../src/auth/auth-config';
import * as authConfig from '../src/auth/auth-config';
import { Public } from '../src/auth/decorators';
import { TokenService } from '../src/auth/token.service';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';

function prismaStub() {
  return {
    isReachable: jest.fn().mockResolvedValue(true),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

/** A controller with no auth decorators at all, added to the running app. */
@Controller('guard-fixture')
class UndecoratedController {
  @Get()
  read(): { reached: true } {
    return { reached: true };
  }
}

/** The same, but explicitly opted out. */
@Controller('guard-fixture-public')
class PublicController {
  @Public()
  @Get()
  read(): { reached: true } {
    return { reached: true };
  }
}

/**
 * Proves the global guard is actually wired into the running application.
 *
 * The unit tests exercise the guard's logic directly; this asserts that it
 * reaches every route through `APP_GUARD`, which no unit test can show. It
 * stubs Prisma so it runs without a database — the real credential flow is
 * in auth.integration-spec.ts.
 */
describe('authentication is the default (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [UndecoratedController, PublicController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub())
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('protects a controller that carries no auth decorators', async () => {
    // This is the property that matters: a task adding a controller and
    // forgetting about auth gets a protected endpoint, not an open one.
    await request(app.getHttpServer()).get('/v1/guard-fixture').expect(401);
  });

  it('admits a controller that explicitly opts out', async () => {
    await request(app.getHttpServer()).get('/v1/guard-fixture-public').expect(200);
  });

  it('protects GET /v1/auth/me', async () => {
    await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
  });

  it.each([
    ['no header', undefined],
    ['an empty bearer', 'Bearer '],
    ['a non-JWT token', 'Bearer not-a-jwt'],
    ['a different scheme', 'Basic dXNlcjpwYXNz'],
    ['an unsigned token', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyXzEifQ.'],
  ])('rejects a protected route with %s', async (_label, authorization) => {
    const call = request(app.getHttpServer()).get('/v1/guard-fixture');
    if (authorization !== undefined) call.set('Authorization', authorization);

    await call.expect(401);
  });

  it('says nothing about why a token was rejected', async () => {
    // "expired" versus "bad signature" tells an attacker which half of a
    // guessed token was right.
    const response = await request(app.getHttpServer())
      .get('/v1/guard-fixture')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);

    expect(JSON.stringify(response.body)).not.toMatch(/signature|expired|malformed|jwt|issuer/i);
  });

  describe('health probes stay public', () => {
    it.each(['/v1/health', '/v1/health/ready'])('serves %s without a token', async (path) => {
      // Infrastructure polling these holds no user credentials.
      await request(app.getHttpServer()).get(path).expect(200);
    });
  });
});

/**
 * The JWT service and the token service must share one signing key.
 *
 * `JwtModule.registerAsync` resolves its factory in a separate injection
 * context. When the config provider was declared in both places, each call
 * produced its own secret — and outside production those are random, so the
 * two disagreed. Nothing failed visibly, because signing and verifying both
 * happened to go through the same one; a second consumer of `AUTH_CONFIG`
 * would have broken.
 */
describe('auth configuration is a single instance (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub())
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs tokens with the same secret the injected config reports', () => {
    const config = app.get<AuthConfig>(AUTH_CONFIG);
    const token = app.get(TokenService).issueAccessToken('user_1').accessToken;

    // Verified with a service built from the injected secret alone: if the
    // module signed with a different one, this throws.
    const independent = new JwtService({
      secret: config.secret,
      verifyOptions: { algorithms: ['HS256'] },
    });

    expect(independent.verify<{ sub: string }>(token).sub).toBe('user_1');
  });

  it('loads the auth configuration exactly once', async () => {
    // The precise property. With the config provider declared separately in
    // both contexts this was 2, and outside production the two secrets were
    // different random values.
    const spy = jest.spyOn(authConfig, 'loadAuthConfig');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub())
      .compile();
    const probe = moduleRef.createNestApplication();
    await probe.init();

    try {
      expect(spy).toHaveBeenCalledTimes(1);
      const secrets = new Set(
        spy.mock.results.map((result) => (result.value as AuthConfig).secret),
      );
      expect(secrets.size).toBe(1);
    } finally {
      spy.mockRestore();
      await probe.close();
    }
  });

  it('resolves the same config object everywhere it is injected', () => {
    expect(app.get<AuthConfig>(AUTH_CONFIG)).toBe(app.get<AuthConfig>(AUTH_CONFIG));
  });
});
