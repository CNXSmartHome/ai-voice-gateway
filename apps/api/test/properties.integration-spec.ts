import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';

/**
 * The properties endpoints against a real database, and the path they exist
 * to unblock: register, create a property, claim a gateway into it.
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
    '\n  DATABASE_URL is not set: skipping property integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

const PASSWORD = 'a-sufficiently-long-password';

describeWithDb('properties (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdEmails: string[] = [];
  const createdGatewayIds: string[] = [];
  let sequence = 0;

  function unique(label: string): string {
    sequence += 1;
    return `${label}-${String(Date.now())}-${String(sequence)}`;
  }

  /**
   * Registers an account and returns its token plus the organization it owns.
   *
   * Through the real endpoint rather than by writing rows, so the caller here
   * is exactly what the guard would see in production.
   */
  async function signUp(label: string) {
    const email = `${unique(label)}@example.test`;
    createdEmails.push(email);

    const response = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        name: `User ${label}`,
        organizationName: `Org ${unique(label)}`,
      })
      .expect(201);

    const body = response.body as {
      accessToken: string;
      user: { id: string; memberships: { organizationId: string }[] };
    };

    return {
      email,
      token: body.accessToken,
      userId: body.user.id,
      organizationId: body.user.memberships[0]?.organizationId ?? '',
    };
  }

  /** Adds an existing user to an organization with the given role. */
  async function addMembership(userId: string, organizationId: string, role: 'ADMIN' | 'MEMBER') {
    await prisma.membership.create({ data: { userId, organizationId, role } });
  }

  /** A fresh token, so the guard reloads memberships changed since sign-up. */
  async function signIn(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  function authorized(token: string | undefined) {
    return (call: request.Test) =>
      token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  }

  function post(token: string | undefined, body: Record<string, unknown>) {
    return authorized(token)(request(app.getHttpServer()).post('/v1/properties').send(body));
  }

  function getAll(token: string) {
    return authorized(token)(request(app.getHttpServer()).get('/v1/properties'));
  }

  function getOne(token: string, id: string) {
    return authorized(token)(request(app.getHttpServer()).get(`/v1/properties/${id}`));
  }

  function patch(token: string, id: string, body: Record<string, unknown>) {
    return authorized(token)(request(app.getHttpServer()).patch(`/v1/properties/${id}`).send(body));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
    const users = await prisma.user.findMany({
      where: { email: { in: createdEmails } },
      select: { memberships: { select: { organizationId: true } } },
    });
    const organizationIds = users.flatMap((user) =>
      user.memberships.map((membership) => membership.organizationId),
    );
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await app.close();
  });

  describe('creating', () => {
    it('creates a property and returns it', async () => {
      const owner = await signUp('create');

      const response = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Villa One',
      }).expect(201);

      expect(response.body).toMatchObject({
        organizationId: owner.organizationId,
        name: 'Villa One',
      });
      expect((response.body as { id: string }).id).toEqual(expect.any(String));
    });

    it('reports the timezone the schema defaulted it to', async () => {
      // Read-only here: setting it is not part of this task.
      const owner = await signUp('default-tz');

      const response = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Villa Default',
      }).expect(201);

      expect((response.body as { timezone: string }).timezone).toBe('UTC');
    });

    it('rejects an unknown field rather than ignoring it', async () => {
      const owner = await signUp('extra');

      await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Villa Extra',
        isAdmin: true,
      }).expect(400);
    });

    it('reports a duplicate name in the same organization', async () => {
      const owner = await signUp('dupe');

      await post(owner.token, { organizationId: owner.organizationId, name: 'Same' }).expect(201);
      await post(owner.token, { organizationId: owner.organizationId, name: 'Same' }).expect(409);
    });

    it('allows the same name in a different organization', async () => {
      const first = await signUp('name-a');
      const second = await signUp('name-b');

      await post(first.token, { organizationId: first.organizationId, name: 'Villa' }).expect(201);
      await post(second.token, { organizationId: second.organizationId, name: 'Villa' }).expect(
        201,
      );
    });

    it('refuses an unauthenticated caller', async () => {
      await post(undefined, { organizationId: 'org_1', name: 'Villa' }).expect(401);
    });

    /*
     * A caller outside the organization has no way to know it exists, so this
     * endpoint must not become the way. One inside it already knows, so a 404
     * would only mislead -- hence a 403 for the member.
     */
    it('answers an organization the caller cannot see with a 404', async () => {
      const outsider = await signUp('outsider');
      const other = await signUp('target');

      await post(outsider.token, {
        organizationId: other.organizationId,
        name: 'Not yours',
      }).expect(404);
    });

    it('answers a member of the organization with a 403', async () => {
      const owner = await signUp('member-owner');
      const member = await signUp('member-guest');
      await addMembership(member.userId, owner.organizationId, 'MEMBER');
      const token = await signIn(member.email);

      await post(token, { organizationId: owner.organizationId, name: 'Resident villa' }).expect(
        403,
      );
    });

    it('lets an ADMIN create one', async () => {
      const owner = await signUp('admin-owner');
      const admin = await signUp('admin-user');
      await addMembership(admin.userId, owner.organizationId, 'ADMIN');
      const token = await signIn(admin.email);

      await post(token, { organizationId: owner.organizationId, name: 'Admin villa' }).expect(201);
    });
  });

  describe('listing and reading', () => {
    it('returns only properties the caller can see', async () => {
      const mine = await signUp('list-mine');
      const theirs = await signUp('list-theirs');

      await post(mine.token, { organizationId: mine.organizationId, name: 'Mine' }).expect(201);
      await post(theirs.token, { organizationId: theirs.organizationId, name: 'Theirs' }).expect(
        201,
      );

      const response = await getAll(mine.token).expect(200);
      const names = (response.body as { name: string }[]).map((property) => property.name);

      expect(names).toContain('Mine');
      expect(names).not.toContain('Theirs');
    });

    it('reads one property back', async () => {
      const owner = await signUp('read-one');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Readable',
      }).expect(201);
      const id = (created.body as { id: string }).id;

      const response = await getOne(owner.token, id).expect(200);

      expect(response.body).toMatchObject({ id, name: 'Readable' });
    });

    it('answers another organization property exactly as a missing one', async () => {
      const owner = await signUp('read-owner');
      const outsider = await signUp('read-outsider');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Private',
      }).expect(201);
      const id = (created.body as { id: string }).id;

      const foreign = await getOne(outsider.token, id).expect(404);
      const missing = await getOne(outsider.token, 'prop_does_not_exist').expect(404);

      // Identical, so the endpoint cannot be used to discover which property
      // ids are real.
      expect((foreign.body as { message: string }).message).toBe(
        (missing.body as { message: string }).message,
      );
    });

    it('lets a MEMBER read, because a resident can see where they live', async () => {
      const owner = await signUp('read-member-owner');
      const guest = await signUp('read-member-guest');
      await addMembership(guest.userId, owner.organizationId, 'MEMBER');
      const token = await signIn(guest.email);

      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Shared villa',
      }).expect(201);

      await getOne(token, (created.body as { id: string }).id).expect(200);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/v1/properties').expect(401);
    });
  });

  describe('updating', () => {
    it('renames a property', async () => {
      const owner = await signUp('rename');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Before',
      }).expect(201);
      const id = (created.body as { id: string }).id;

      const response = await patch(owner.token, id, { name: 'After' }).expect(200);

      expect((response.body as { name: string }).name).toBe('After');
      await expect(
        prisma.property.findUniqueOrThrow({ where: { id } }).then((row) => row.name),
      ).resolves.toBe('After');
    });

    it('refuses a body with no name', async () => {
      const owner = await signUp('empty-patch');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Untouched',
      }).expect(201);

      await patch(owner.token, (created.body as { id: string }).id, {}).expect(400);
    });

    it('refuses an attempt to move a property to another organization', async () => {
      const owner = await signUp('move-owner');
      const other = await signUp('move-other');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Stays put',
      }).expect(201);
      const id = (created.body as { id: string }).id;

      // Rejected by the validation pipe as an unknown field, so the property
      // cannot be walked across an authorization boundary by a rename.
      await patch(owner.token, id, { organizationId: other.organizationId }).expect(400);

      const row = await prisma.property.findUniqueOrThrow({ where: { id } });
      expect(row.organizationId).toBe(owner.organizationId);
    });

    it('answers a property the caller cannot see with a 404', async () => {
      const owner = await signUp('patch-owner');
      const outsider = await signUp('patch-outsider');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Not yours',
      }).expect(201);

      await patch(outsider.token, (created.body as { id: string }).id, {
        name: 'Mine now',
      }).expect(404);
    });

    /*
     * Authorization is decided from a row read before the write, and a
     * property can be moved to another organization in between. Without the
     * organization carried into the write predicate, a request authorized
     * against one organization would modify a property belonging to another.
     *
     * The window is opened deliberately rather than raced for: the write
     * happens inside the service transaction, so moving the property
     * immediately before that transaction runs places the change exactly
     * where a real one would have to land.
     */
    it('cannot rename a property whose organization changed after authorization', async () => {
      const owner = await signUp('race-owner');
      const other = await signUp('race-other');
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Before the race',
      }).expect(201);
      const id = (created.body as { id: string }).id;

      const runTransaction = prisma.$transaction.bind(prisma) as (argument: unknown) => unknown;
      const intercept = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (argument: unknown) => {
          intercept.mockRestore();
          await prisma.property.update({
            where: { id },
            data: { organizationId: other.organizationId },
          });
          return runTransaction(argument);
        }) as unknown as jest.SpyInstance;

      try {
        // The same answer as a property they cannot see, which by now it is.
        await patch(owner.token, id, { name: 'Renamed anyway' }).expect(404);
      } finally {
        intercept.mockRestore();
      }

      const row = await prisma.property.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe('Before the race');
      expect(row.organizationId).toBe(other.organizationId);
    });

    it('answers a MEMBER of the organization with a 403', async () => {
      const owner = await signUp('patch-member-owner');
      const guest = await signUp('patch-member-guest');
      await addMembership(guest.userId, owner.organizationId, 'MEMBER');
      const token = await signIn(guest.email);

      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Read only',
      }).expect(201);

      await patch(token, (created.body as { id: string }).id, { name: 'Renamed' }).expect(403);
    });

    it('reports a rename onto an existing name', async () => {
      const owner = await signUp('patch-dupe');
      await post(owner.token, { organizationId: owner.organizationId, name: 'Taken' }).expect(201);
      const created = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Free',
      }).expect(201);

      await patch(owner.token, (created.body as { id: string }).id, { name: 'Taken' }).expect(409);
    });
  });

  /*
   * The reason this task exists. VG-005 has required a propertyId since it
   * was written and nothing could produce one, so the claim endpoint was
   * unreachable by any client. This is the whole path an app takes.
   */
  describe('the path this unblocks', () => {
    it('registers, creates a property, and claims a gateway into it', async () => {
      const owner = await signUp('e2e');

      const property = await post(owner.token, {
        organizationId: owner.organizationId,
        name: 'Day 7 villa',
      }).expect(201);
      const propertyId = (property.body as { id: string }).id;

      const gateway = await prisma.gateway.create({
        data: { serialNumber: `VG100-${unique('e2e')}`.slice(0, 64), name: 'VG-100' },
      });
      createdGatewayIds.push(gateway.id);

      const claimed = await request(app.getHttpServer())
        .post('/v1/gateways/claim')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ serialNumber: gateway.serialNumber, propertyId })
        .expect(200);

      expect(claimed.body).toMatchObject({
        id: gateway.id,
        serialNumber: gateway.serialNumber,
        propertyId,
        // Claimed, not connected. The heartbeat (VG-006) is what brings it
        // online.
        status: 'OFFLINE',
      });
    });
  });
});
