import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';

/**
 * Reading gateways back after they are claimed.
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
    '\n  DATABASE_URL is not set: skipping gateway read integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

const PASSWORD = 'a-sufficiently-long-password';

describeWithDb('reading gateways (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdEmails: string[] = [];
  const createdGatewayIds: string[] = [];
  let sequence = 0;

  function unique(label: string): string {
    sequence += 1;
    return `${label}-${String(Date.now())}-${String(sequence)}`;
  }

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

  async function signIn(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  /** A claimed gateway in a fresh property, through the real endpoints. */
  async function claimedGateway(token: string, organizationId: string, label: string) {
    const property = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId, name: `Villa ${unique(label)}` })
      .expect(201);
    const propertyId = (property.body as { id: string }).id;

    const manufactured = await prisma.gateway.create({
      data: { serialNumber: `VG100-${unique(label)}`.slice(0, 64), name: 'VG-100' },
    });
    createdGatewayIds.push(manufactured.id);

    const claimed = await request(app.getHttpServer())
      .post('/v1/gateways/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ serialNumber: manufactured.serialNumber, propertyId })
      .expect(200);

    return { gateway: claimed.body as { id: string; serialNumber: string }, propertyId };
  }

  function list(token: string, query = '') {
    return request(app.getHttpServer())
      .get(`/v1/gateways${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function getOne(token: string, id: string) {
    return request(app.getHttpServer())
      .get(`/v1/gateways/${id}`)
      .set('Authorization', `Bearer ${token}`);
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

  describe('one gateway', () => {
    it('reads back a gateway that was claimed', async () => {
      const owner = await signUp('read');
      const { gateway, propertyId } = await claimedGateway(
        owner.token,
        owner.organizationId,
        'read',
      );

      const response = await getOne(owner.token, gateway.id).expect(200);

      expect(response.body).toMatchObject({
        id: gateway.id,
        serialNumber: gateway.serialNumber,
        propertyId,
        status: 'OFFLINE',
      });
    });

    it('answers a gateway in another organization exactly as a missing one', async () => {
      const owner = await signUp('foreign-owner');
      const outsider = await signUp('foreign-outsider');
      const { gateway } = await claimedGateway(owner.token, owner.organizationId, 'foreign');

      const foreign = await getOne(outsider.token, gateway.id).expect(404);
      const missing = await getOne(outsider.token, 'gw_does_not_exist').expect(404);

      expect((foreign.body as { message: string }).message).toBe(
        (missing.body as { message: string }).message,
      );
    });

    /*
     * An unclaimed gateway belongs to no organization. Its serial number is
     * manufactured-but-unsold inventory, and nobody should be able to read it
     * -- least of all to learn which serials are worth trying to claim.
     */
    it('hides an unclaimed gateway from everyone', async () => {
      const owner = await signUp('unclaimed');
      const manufactured = await prisma.gateway.create({
        data: { serialNumber: `VG100-${unique('unclaimed')}`.slice(0, 64), name: 'VG-100' },
      });
      createdGatewayIds.push(manufactured.id);

      await getOne(owner.token, manufactured.id).expect(404);
    });

    it('lets a MEMBER read: a resident should see the gateway in their room', async () => {
      const owner = await signUp('member-owner');
      const guest = await signUp('member-guest');
      await prisma.membership.create({
        data: { userId: guest.userId, organizationId: owner.organizationId, role: 'MEMBER' },
      });
      const guestToken = await signIn(guest.email);

      const { gateway } = await claimedGateway(owner.token, owner.organizationId, 'member');

      await getOne(guestToken, gateway.id).expect(200);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/v1/gateways/gw_1').expect(401);
    });

    /*
     * The response is an allow-list, so this asserts the exact set of keys
     * rather than grepping for words that look sensitive. A column added to
     * `Gateway` later — the device credential relation among them — fails
     * here instead of leaking until someone remembers to filter it.
     */
    it('returns exactly the documented fields and nothing else', async () => {
      const owner = await signUp('shape');
      const { gateway } = await claimedGateway(owner.token, owner.organizationId, 'shape');

      const response = await getOne(owner.token, gateway.id).expect(200);

      expect(Object.keys(response.body as object).sort()).toEqual([
        'createdAt',
        'firmwareVersion',
        'id',
        'lastSeenAt',
        'name',
        'propertyId',
        'roomId',
        'serialNumber',
        'status',
        'updatedAt',
      ]);
    });
  });

  describe('the list', () => {
    it('returns only gateways the caller can see', async () => {
      const mine = await signUp('list-mine');
      const theirs = await signUp('list-theirs');
      const own = await claimedGateway(mine.token, mine.organizationId, 'list-mine');
      const other = await claimedGateway(theirs.token, theirs.organizationId, 'list-theirs');

      const response = await list(mine.token).expect(200);
      const ids = (response.body as { id: string }[]).map((gateway) => gateway.id);

      expect(ids).toContain(own.gateway.id);
      expect(ids).not.toContain(other.gateway.id);
    });

    it('never includes an unclaimed gateway', async () => {
      const owner = await signUp('list-unclaimed');
      const manufactured = await prisma.gateway.create({
        data: { serialNumber: `VG100-${unique('list-unclaimed')}`.slice(0, 64), name: 'VG-100' },
      });
      createdGatewayIds.push(manufactured.id);

      const response = await list(owner.token).expect(200);
      const ids = (response.body as { id: string }[]).map((gateway) => gateway.id);

      expect(ids).not.toContain(manufactured.id);
    });

    it('narrows to one property', async () => {
      const owner = await signUp('list-filter');
      const first = await claimedGateway(owner.token, owner.organizationId, 'filter-a');
      const second = await claimedGateway(owner.token, owner.organizationId, 'filter-b');

      const response = await list(owner.token, `?propertyId=${first.propertyId}`).expect(200);
      const ids = (response.body as { id: string }[]).map((gateway) => gateway.id);

      expect(ids).toEqual([first.gateway.id]);
      expect(ids).not.toContain(second.gateway.id);
    });

    /*
     * A filter, not a lookup. Raising for a property the caller cannot see
     * would turn the query parameter into a way to test whether a property id
     * is real.
     */
    it('returns nothing for a property the caller cannot see, rather than an error', async () => {
      const owner = await signUp('filter-owner');
      const outsider = await signUp('filter-outsider');
      const { propertyId } = await claimedGateway(owner.token, owner.organizationId, 'filter');

      const response = await list(outsider.token, `?propertyId=${propertyId}`).expect(200);

      expect(response.body).toEqual([]);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      const owner = await signUp('list-extra');

      await list(owner.token, '?organizationId=org_1').expect(400);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/v1/gateways').expect(401);
    });
  });

  /*
   * The point of the task: VG-006 moves a gateway to ONLINE when it connects,
   * and until now nothing could read that it had. The status is written here
   * directly rather than by opening a session, because the session lifecycle
   * has its own suite -- what matters is that a change reaches a reader.
   */
  describe('what the app is waiting for', () => {
    it('shows a status change made after the claim', async () => {
      const owner = await signUp('online');
      const { gateway } = await claimedGateway(owner.token, owner.organizationId, 'online');

      await expect(
        getOne(owner.token, gateway.id)
          .expect(200)
          .then((response) => (response.body as { status: string }).status),
      ).resolves.toBe('OFFLINE');

      await prisma.gateway.update({
        where: { id: gateway.id },
        data: { status: 'ONLINE', lastSeenAt: new Date() },
      });

      const response = await getOne(owner.token, gateway.id).expect(200);

      expect(response.body).toMatchObject({ status: 'ONLINE' });
      expect((response.body as { lastSeenAt: string | null }).lastSeenAt).not.toBeNull();
    });
  });
});
