import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import { TokenService } from '../src/auth/token.service';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';

const CALLER: AuthenticatedUser = {
  id: 'user_1',
  email: 'owner@example.com',
  name: 'Owner',
  memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
};

/**
 * Controller wiring and request validation for the claim endpoint, with the
 * database stubbed so this runs everywhere.
 *
 * The claim's behaviour against real rows — the concurrency guard above all —
 * is in gateways.integration-spec.ts, which needs PostgreSQL.
 */
describe('gateway claim endpoint (integration)', () => {
  let app: INestApplication;
  let token: string;
  let propertyFindUnique: jest.Mock;

  beforeAll(async () => {
    propertyFindUnique = jest.fn().mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        isReachable: jest.fn().mockResolvedValue(true),
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        // The guard reloads the caller on every request.
        user: {
          findUnique: jest.fn().mockResolvedValue({ ...CALLER, status: 'ACTIVE' }),
        },
        $transaction: (callback: (client: unknown) => unknown) =>
          callback({
            property: { findUnique: propertyFindUnique },
            room: { findUnique: jest.fn().mockResolvedValue(null) },
            gateway: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              findUniqueOrThrow: jest.fn(),
            },
          }),
      })
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    token = app.get(TokenService).issueAccessToken(CALLER.id).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  function claim(authorization: string | undefined, body: Record<string, unknown>) {
    const call = request(app.getHttpServer()).post('/v1/gateways/claim').send(body);
    return authorization === undefined ? call : call.set('Authorization', authorization);
  }

  const VALID = { serialNumber: 'VG100-0001', propertyId: 'prop_1' };

  describe('authentication', () => {
    it('rejects an unauthenticated claim', async () => {
      // The controller carries no @Public(), so the global guard applies.
      await claim(undefined, VALID).expect(401);
    });

    it.each([
      ['a malformed token', 'Bearer not-a-jwt'],
      ['an empty bearer', 'Bearer '],
      ['a different scheme', 'Basic dXNlcjpwYXNz'],
      ['an unsigned token', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyXzEifQ.'],
    ])('rejects %s', async (_label, authorization) => {
      await claim(authorization, VALID).expect(401);
    });

    it('does not touch the database for an unauthenticated request', async () => {
      propertyFindUnique.mockClear();

      await claim(undefined, VALID).expect(401);

      expect(propertyFindUnique).not.toHaveBeenCalled();
    });

    it('reaches the service with a valid token', async () => {
      propertyFindUnique.mockClear();

      // 404 because the stub reports no such property; the point is that the
      // request got past the guard and the pipe.
      await claim(`Bearer ${token}`, VALID).expect(404);

      expect(propertyFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prop_1' } }),
      );
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing serial number', { serialNumber: undefined }],
      ['a missing property', { propertyId: undefined }],
      ['an empty serial number', { serialNumber: '' }],
      ['a serial number that is too short', { serialNumber: 'VG1' }],
      ['a serial number that is too long', { serialNumber: 'V'.repeat(65) }],
      ['a serial number with a space', { serialNumber: 'VG100 0001' }],
      ['a serial number with punctuation', { serialNumber: "VG100'; DROP TABLE gateways;--" }],
      ['a non-string serial number', { serialNumber: 12345 }],
      ['a non-string property', { propertyId: { id: 'x' } }],
      ['an empty room', { roomId: '' }],
      ['an empty name', { name: '' }],
      ['an unknown field', { unexpected: true }],
    ])('rejects %s with 400', async (_label, override) => {
      await claim(`Bearer ${token}`, { ...VALID, ...override }).expect(400);
    });

    it('accepts an optional room and name', async () => {
      await claim(`Bearer ${token}`, { ...VALID, roomId: 'room_1', name: 'Hall' }).expect(404);
    });

    it('rejects an unauthenticated malformed request as unauthorized, not invalid', async () => {
      // Authentication runs before validation, so an anonymous caller cannot
      // use 400-versus-401 to map the request schema.
      await claim(undefined, { nonsense: true }).expect(401);
    });

    it('does not echo the rejected value back', async () => {
      const response = await claim(`Bearer ${token}`, {
        ...VALID,
        serialNumber: "VG100'; DROP TABLE gateways;--",
      }).expect(400);

      expect(JSON.stringify(response.body)).not.toContain('DROP TABLE');
    });
  });

  describe('rejection shape', () => {
    it('says nothing about why the claim did not apply', async () => {
      const response = await claim(`Bearer ${token}`, VALID).expect(404);

      expect(JSON.stringify(response.body)).not.toMatch(
        /prisma|constraint|organization|membership|unauthorized|forbidden/i,
      );
      expect(JSON.stringify(response.body)).not.toContain('VG100-0001');
    });
  });
});
