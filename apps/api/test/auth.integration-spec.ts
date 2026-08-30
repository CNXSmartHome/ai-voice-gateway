import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';

/**
 * The credential flow against a real database: registration, login, and a
 * protected request, plus the rejection paths.
 *
 * Requires DATABASE_URL. CI provides a PostgreSQL service container; see
 * `docs/CI.md`. Without it the suite is skipped rather than failing, so a
 * developer with no local database still gets a green unit run.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console -- visibility matters more than lint here
  console.warn(
    '\n  DATABASE_URL is not set: skipping auth integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

const PASSWORD = 'a-sufficiently-long-password';

describeWithDb('authentication endpoints (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdOrganizationNames: string[] = [];

  /** A registration payload with an address unique to this run. */
  function registration(label: string) {
    const email = `vg-${label}-${String(Date.now())}@example.test`;
    const organizationName = `Org ${label} ${String(Date.now())}`;
    createdEmails.push(email);
    createdOrganizationNames.push(organizationName);

    return { email, password: PASSWORD, name: `User ${label}`, organizationName };
  }

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(`/v1/auth/${path}`).send(body);
  }

  async function registerUser(label: string) {
    const payload = registration(label);
    const response = await post('register', payload).expect(201);

    return { payload, body: response.body as Record<string, any> };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Users cascade to their memberships; organizations are removed by name
    // because a rolled-back registration must leave none behind to find.
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.organization.deleteMany({ where: { name: { in: createdOrganizationNames } } });
    await app.close();
  });

  describe('POST /v1/auth/register', () => {
    it('creates the account and returns a usable token', async () => {
      const { payload, body } = await registerUser('register');

      expect(body.tokenType).toBe('Bearer');
      expect(typeof body.accessToken).toBe('string');
      expect(body.expiresIn).toBeGreaterThan(0);
      expect(body.user).toMatchObject({ email: payload.email, name: payload.name });
    });

    it('creates an organization and an owner membership', async () => {
      const { payload } = await registerUser('owner');

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: payload.email },
        include: { memberships: { include: { organization: true } } },
      });

      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]?.role).toBe('OWNER');
      expect(user.memberships[0]?.organization.name).toBe(payload.organizationName);
    });

    it('stores the password only as a hash', async () => {
      const { payload } = await registerUser('hashing');

      const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });

      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(user.passwordHash).toMatch(/^scrypt\$v=1\$/);
    });

    it('normalizes the address so it cannot be registered twice by case', async () => {
      const payload = registration('case');
      await post('register', payload).expect(201);

      await post('register', { ...payload, email: payload.email.toUpperCase() }).expect(409);
    });

    it('rejects an address that is already registered', async () => {
      const payload = registration('duplicate');
      await post('register', payload).expect(201);

      const response = await post('register', payload).expect(409);

      // The message must not confirm which part of the request collided.
      expect(JSON.stringify(response.body)).not.toContain(payload.email);
    });

    it('leaves no organization behind when registration fails', async () => {
      // The organization is created first inside the transaction, so a
      // rejected registration is what proves the rollback works.
      const first = registration('atomic-first');
      await post('register', first).expect(201);

      const orphanName = `Org orphan ${String(Date.now())}`;
      createdOrganizationNames.push(orphanName);
      await post('register', { ...first, organizationName: orphanName }).expect(409);

      await expect(
        prisma.organization.findFirst({ where: { name: orphanName } }),
      ).resolves.toBeNull();
    });

    it.each([
      ['a malformed email', { email: 'not-an-email' }],
      ['a short password', { password: 'short' }],
      ['a missing name', { name: undefined }],
      ['a missing organization name', { organizationName: undefined }],
      ['an unknown field', { role: 'OWNER' }],
    ])('rejects %s', async (_label, override) => {
      await post('register', { ...registration('invalid'), ...override }).expect(400);
    });

    it('never returns the password hash', async () => {
      const { body } = await registerUser('no-hash');

      expect(JSON.stringify(body)).not.toMatch(/passwordHash|password_hash|scrypt\$/);
    });
  });

  describe('POST /v1/auth/login', () => {
    it('returns a token for valid credentials', async () => {
      const { payload } = await registerUser('login');

      const response = await post('login', {
        email: payload.email,
        password: PASSWORD,
      }).expect(200);

      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.user.email).toBe(payload.email);
    });

    it('accepts the address in any case', async () => {
      const { payload } = await registerUser('login-case');

      await post('login', { email: payload.email.toUpperCase(), password: PASSWORD }).expect(200);
    });

    it('rejects a wrong password and an unknown address identically', async () => {
      const { payload } = await registerUser('oracle');

      const wrongPassword = await post('login', {
        email: payload.email,
        password: 'not-the-right-password',
      }).expect(401);

      const unknownAddress = await post('login', {
        email: `nobody-${String(Date.now())}@example.test`,
        password: PASSWORD,
      }).expect(401);

      // Identical bodies: the response must not reveal whether the account
      // exists. Timing is equalized in PasswordService.
      expect(unknownAddress.body).toEqual(wrongPassword.body);
    });

    it('rejects a disabled account without saying it is disabled', async () => {
      const { payload } = await registerUser('disabled');
      await prisma.user.update({ where: { email: payload.email }, data: { status: 'DISABLED' } });

      const response = await post('login', { email: payload.email, password: PASSWORD }).expect(
        401,
      );

      expect(JSON.stringify(response.body)).not.toMatch(/disabled/i);
    });

    it('never returns the password hash', async () => {
      const { payload } = await registerUser('login-no-hash');

      const response = await post('login', { email: payload.email, password: PASSWORD });

      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash|scrypt\$/);
    });
  });

  describe('GET /v1/auth/me', () => {
    function me(token?: string) {
      const call = request(app.getHttpServer()).get('/v1/auth/me');
      return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
    }

    it('returns the caller and their memberships', async () => {
      const { payload, body } = await registerUser('me');

      const response = await me(body.accessToken).expect(200);

      expect(response.body).toMatchObject({ email: payload.email, name: payload.name });
      expect(response.body.memberships).toHaveLength(1);
      expect(response.body.memberships[0].role).toBe('OWNER');
    });

    it('accepts a token obtained from login, not only from register', async () => {
      const { payload } = await registerUser('me-login');
      const login = await post('login', { email: payload.email, password: PASSWORD }).expect(200);

      await me(login.body.accessToken).expect(200);
    });

    it('rejects a request with no token', async () => {
      await me().expect(401);
    });

    it('rejects a token whose payload has been altered', async () => {
      const { body } = await registerUser('me-tampered');
      const [header, , signature] = (body.accessToken as string).split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'someone-else' }), 'utf8')
        .toString('base64url')
        .replace(/=+$/, '');

      await me(`${header ?? ''}.${forged}.${signature ?? ''}`).expect(401);
    });

    it('stops accepting a valid token once the account is disabled', async () => {
      // The token is still cryptographically fine; the account is not.
      const { payload, body } = await registerUser('me-disabled');
      await me(body.accessToken).expect(200);

      await prisma.user.update({ where: { email: payload.email }, data: { status: 'DISABLED' } });

      await me(body.accessToken).expect(401);
    });

    it('stops accepting a valid token once the user is deleted', async () => {
      const { payload, body } = await registerUser('me-deleted');
      await prisma.user.delete({ where: { email: payload.email } });

      await me(body.accessToken).expect(401);
    });

    it('never returns the password hash', async () => {
      const { body } = await registerUser('me-no-hash');

      const response = await me(body.accessToken).expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash|scrypt\$/);
    });
  });
});
