import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { GatewaysService } from '../src/gateways/gateways.service';
import { configureApp } from '../src/configure-app';

/**
 * The claim flow against a real database, including the concurrency guard,
 * which no mock can demonstrate.
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
    '\n  DATABASE_URL is not set: skipping gateway claim integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

const PASSWORD = 'a-sufficiently-long-password';

describeWithDb('gateway claim (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdEmails: string[] = [];
  const createdGatewayIds: string[] = [];
  let sequence = 0;

  /** A unique suffix per call, so parallel rows never collide. */
  function unique(label: string): string {
    sequence += 1;
    return `${label}-${String(Date.now())}-${String(sequence)}`;
  }

  /**
   * Registers an account and returns its token plus the organization it owns.
   *
   * Goes through the real endpoint rather than writing rows directly, so the
   * caller in these tests is exactly what the guard would see in production.
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

  /** A property, and a room in it, owned by the given organization. */
  async function createProperty(organizationId: string, label: string) {
    const property = await prisma.property.create({
      data: { organizationId, name: `Villa ${unique(label)}` },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: `Room ${unique(label)}` },
    });

    return { property, room };
  }

  /** A manufactured, unclaimed gateway. */
  async function manufacture(label: string) {
    const gateway = await prisma.gateway.create({
      data: { serialNumber: `VG100-${unique(label)}`.slice(0, 64), name: 'VG-100' },
    });
    createdGatewayIds.push(gateway.id);

    return gateway;
  }

  function claim(token: string | undefined, body: Record<string, unknown>) {
    const call = request(app.getHttpServer()).post('/v1/gateways/claim').send(body);
    return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
    // Users cascade to memberships; deleting the organizations they own
    // cascades to properties, rooms, and any gateway still attached.
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

  describe('a successful claim', () => {
    it('binds the gateway to the property and reports it offline', async () => {
      const owner = await signUp('claim-ok');
      const { property } = await createProperty(owner.organizationId, 'claim-ok');
      const gateway = await manufacture('claim-ok');

      const response = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);

      expect(response.body).toMatchObject({
        id: gateway.id,
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
        status: 'OFFLINE',
        roomId: null,
      });
    });

    it('keeps the hardware identity: same id, serial, and creation time', async () => {
      // The claim updates the manufactured row. A replacement would break
      // every record that already refers to this gateway.
      const owner = await signUp('identity');
      const { property } = await createProperty(owner.organizationId, 'identity');
      const gateway = await manufacture('identity');

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);

      const after = await prisma.gateway.findUniqueOrThrow({
        where: { serialNumber: gateway.serialNumber },
      });

      expect(after.id).toBe(gateway.id);
      expect(after.createdAt).toEqual(gateway.createdAt);
      await expect(
        prisma.gateway.count({ where: { serialNumber: gateway.serialNumber } }),
      ).resolves.toBe(1);
    });

    it('assigns a room in the same property', async () => {
      const owner = await signUp('with-room');
      const { property, room } = await createProperty(owner.organizationId, 'with-room');
      const gateway = await manufacture('with-room');

      const response = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
        roomId: room.id,
      }).expect(200);

      expect(response.body.roomId).toBe(room.id);
    });

    it('applies a supplied name', async () => {
      const owner = await signUp('named');
      const { property } = await createProperty(owner.organizationId, 'named');
      const gateway = await manufacture('named');

      const response = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
        name: 'Hall gateway',
      }).expect(200);

      expect(response.body.name).toBe('Hall gateway');
    });

    it('exposes no credential, secret, or internal field', async () => {
      const owner = await signUp('leak-check');
      const { property } = await createProperty(owner.organizationId, 'leak-check');
      const gateway = await manufacture('leak-check');

      const response = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);

      // The fixture must not contain a trigger word itself, or the scan below
      // reports a leak that is really just the test's own label echoed back in
      // the serial number.
      const CREDENTIAL_LIKE = /secret|token|password|credential|apiKey/i;
      expect(gateway.serialNumber).not.toMatch(CREDENTIAL_LIKE);

      expect(JSON.stringify(response.body)).not.toMatch(CREDENTIAL_LIKE);
      expect(Object.keys(response.body).sort()).toEqual([
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

  describe('a gateway can be claimed only once', () => {
    it('rejects a second claim and keeps the first owner', async () => {
      const first = await signUp('first-owner');
      const second = await signUp('second-owner');
      const firstProperty = await createProperty(first.organizationId, 'first-owner');
      const secondProperty = await createProperty(second.organizationId, 'second-owner');
      const gateway = await manufacture('claim-twice');

      await claim(first.token, {
        serialNumber: gateway.serialNumber,
        propertyId: firstProperty.property.id,
      }).expect(200);

      await claim(second.token, {
        serialNumber: gateway.serialNumber,
        propertyId: secondProperty.property.id,
      }).expect(404);

      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({ propertyId: firstProperty.property.id, status: 'OFFLINE' });
    });

    it('rejects the same owner claiming twice', async () => {
      const owner = await signUp('same-twice');
      const { property } = await createProperty(owner.organizationId, 'same-twice');
      const gateway = await manufacture('same-twice');

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);
    });

    it('resolves concurrent claims to exactly one winner', async () => {
      // The real race. Without the `status = UNCLAIMED` guard in the update,
      // both callers could believe they own the gateway.
      const first = await signUp('race-a');
      const second = await signUp('race-b');
      const firstProperty = await createProperty(first.organizationId, 'race-a');
      const secondProperty = await createProperty(second.organizationId, 'race-b');
      const gateway = await manufacture('race');

      const results = await Promise.all([
        claim(first.token, {
          serialNumber: gateway.serialNumber,
          propertyId: firstProperty.property.id,
        }),
        claim(second.token, {
          serialNumber: gateway.serialNumber,
          propertyId: secondProperty.property.id,
        }),
      ]);

      const statuses = results.map((result) => result.status).sort((a, b) => a - b);
      expect(statuses).toEqual([200, 404]);

      // Whoever won, the gateway belongs to exactly one of them.
      const after = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });
      expect([firstProperty.property.id, secondProperty.property.id]).toContain(after.propertyId);
      expect(after.status).toBe('OFFLINE');
    });

    it('survives many simultaneous claims of one gateway', async () => {
      const owner = await signUp('stampede');
      const { property } = await createProperty(owner.organizationId, 'stampede');
      const gateway = await manufacture('stampede');

      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          claim(owner.token, {
            serialNumber: gateway.serialNumber,
            propertyId: property.id,
          }),
        ),
      );

      expect(attempts.filter((attempt) => attempt.status === 200)).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === 404)).toHaveLength(7);
    });
  });

  describe('an inconsistent row cannot be claimed', () => {
    /**
     * A gateway in a state nothing in this service can produce: `UNCLAIMED`
     * while still holding ownership columns.
     *
     * The schema permits it because Postgres cannot express "UNCLAIMED
     * implies no property" without a CHECK constraint Prisma does not model.
     * If the claim guarded on status alone, such a row would match and be
     * moved to whoever claimed it next — turning a data-integrity fault into
     * an ownership transfer.
     */
    async function manufactureInconsistent(
      label: string,
      ownership: { propertyId?: string; roomId?: string },
    ) {
      const gateway = await prisma.gateway.create({
        data: {
          serialNumber: `VG100-${unique(label)}`.slice(0, 64),
          name: 'VG-100',
          status: 'UNCLAIMED',
          ...ownership,
        },
      });
      createdGatewayIds.push(gateway.id);

      return gateway;
    }

    it('refuses an UNCLAIMED gateway that already holds a property', async () => {
      const victim = await signUp('drift-victim');
      const attacker = await signUp('drift-attacker');
      const victimProperty = await createProperty(victim.organizationId, 'drift-victim');
      const attackerProperty = await createProperty(attacker.organizationId, 'drift-attacker');

      const gateway = await manufactureInconsistent('drift', {
        propertyId: victimProperty.property.id,
      });

      await claim(attacker.token, {
        serialNumber: gateway.serialNumber,
        propertyId: attackerProperty.property.id,
      }).expect(404);

      // Untouched: still pointing at the property it held, not the claimant's.
      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({
        propertyId: victimProperty.property.id,
        status: 'UNCLAIMED',
      });
    });

    it('refuses even when the claimant owns the property the row points at', async () => {
      // Not an authorization question. The row is in a state this service
      // cannot produce, so it is not claimable by anyone until it is
      // reconciled — being entitled to the property does not change that.
      const owner = await signUp('drift-self');
      const { property } = await createProperty(owner.organizationId, 'drift-self');

      const gateway = await manufactureInconsistent('drift-self', { propertyId: property.id });

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);

      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({ status: 'UNCLAIMED', propertyId: property.id });
    });

    it('refuses an UNCLAIMED gateway that already holds a room', async () => {
      // A room belongs to a property, so a room without a property is
      // inconsistent on the same reasoning.
      const owner = await signUp('drift-room');
      const { property, room } = await createProperty(owner.organizationId, 'drift-room');

      const gateway = await manufactureInconsistent('drift-room', { roomId: room.id });

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);

      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({ propertyId: null, roomId: room.id, status: 'UNCLAIMED' });
    });

    it('rejects it with the same body as any other failure', async () => {
      // The refusal must not advertise that a row is in a broken state.
      const owner = await signUp('drift-shape');
      const { property } = await createProperty(owner.organizationId, 'drift-shape');
      const gateway = await manufactureInconsistent('drift-shape', { propertyId: property.id });

      const inconsistent = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);

      const unknownSerial = await claim(owner.token, {
        serialNumber: 'VG100-not-registered',
        propertyId: property.id,
      }).expect(404);

      expect(inconsistent.body).toEqual(unknownSerial.body);
    });

    it('still claims a properly manufactured gateway', async () => {
      // The tightened predicate must not have made the normal path stricter
      // than intended.
      const owner = await signUp('drift-control');
      const { property } = await createProperty(owner.organizationId, 'drift-control');
      const gateway = await manufacture('drift-control');

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);
    });
  });

  describe('failures are indistinguishable and leave nothing behind', () => {
    it('returns an identical body for an unknown serial and an already-claimed one', async () => {
      const owner = await signUp('oracle');
      const { property } = await createProperty(owner.organizationId, 'oracle');
      const gateway = await manufacture('oracle');
      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);

      const alreadyClaimed = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);

      const unknownSerial = await claim(owner.token, {
        serialNumber: 'VG100-does-not-exist',
        propertyId: property.id,
      }).expect(404);

      // Distinguishing these would let anyone enumerate the manufacturing
      // run and learn which units are already in service.
      expect(unknownSerial.body).toEqual(alreadyClaimed.body);
    });

    it('returns an identical body for a foreign property and one that does not exist', async () => {
      const owner = await signUp('prop-oracle');
      const stranger = await signUp('prop-stranger');
      const strangersProperty = await createProperty(stranger.organizationId, 'prop-stranger');
      const gateway = await manufacture('prop-oracle');

      const foreign = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: strangersProperty.property.id,
      }).expect(404);

      const missing = await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: 'prop_does_not_exist',
      }).expect(404);

      expect(missing.body).toEqual(foreign.body);
    });

    it('never leaks a driver error or schema detail', async () => {
      const owner = await signUp('no-leak');
      const { property } = await createProperty(owner.organizationId, 'no-leak');

      const response = await claim(owner.token, {
        serialNumber: 'VG100-absent',
        propertyId: property.id,
      }).expect(404);

      expect(JSON.stringify(response.body)).not.toMatch(
        /prisma|P2\d{3}|constraint|foreign key|relation|column|postgres|ECONNREFUSED/i,
      );
    });

    it('leaves the gateway claimable after a rejected claim', async () => {
      // A failure must not consume the gateway, or a mistyped property id
      // would brick a unit.
      const owner = await signUp('rollback');
      const stranger = await signUp('rollback-stranger');
      const strangersProperty = await createProperty(stranger.organizationId, 'rollback-stranger');
      const ownersProperty = await createProperty(owner.organizationId, 'rollback');
      const gateway = await manufacture('rollback');

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: strangersProperty.property.id,
      }).expect(404);

      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({ propertyId: null, status: 'UNCLAIMED' });

      // Still claimable by someone entitled to it.
      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: ownersProperty.property.id,
      }).expect(200);
    });

    it('does not assign the gateway when the room is rejected', async () => {
      const owner = await signUp('bad-room');
      const first = await createProperty(owner.organizationId, 'bad-room-a');
      const second = await createProperty(owner.organizationId, 'bad-room-b');
      const gateway = await manufacture('bad-room');

      // A room from a different property, even one the caller owns.
      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: first.property.id,
        roomId: second.room.id,
      }).expect(404);

      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({ propertyId: null, roomId: null, status: 'UNCLAIMED' });
    });
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const gateway = await manufacture('anon');

      await claim(undefined, {
        serialNumber: gateway.serialNumber,
        propertyId: 'prop_anything',
      }).expect(401);
    });

    it.each([
      ['a malformed token', 'not-a-jwt'],
      ['an unsigned token', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyXzEifQ.'],
    ])('rejects %s', async (_label, token) => {
      await claim(token, { serialNumber: 'VG100-x', propertyId: 'prop_x' }).expect(401);
    });

    it('rejects a caller with no membership of the owning organization', async () => {
      const owner = await signUp('authz-owner');
      const stranger = await signUp('authz-stranger');
      const { property } = await createProperty(owner.organizationId, 'authz-owner');
      const gateway = await manufacture('authz');

      await claim(stranger.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);

      await expect(
        prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } }),
      ).resolves.toMatchObject({ propertyId: null, status: 'UNCLAIMED' });
    });

    it('rejects a MEMBER of the owning organization', async () => {
      // Membership alone is not enough: attaching hardware is administrative.
      const owner = await signUp('member-owner');
      const resident = await signUp('member-resident');
      const { property } = await createProperty(owner.organizationId, 'member-owner');
      const gateway = await manufacture('member');

      await prisma.membership.create({
        data: {
          userId: resident.userId,
          organizationId: owner.organizationId,
          role: 'MEMBER',
        },
      });

      await claim(resident.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(404);
    });

    it('allows an ADMIN of the owning organization', async () => {
      const owner = await signUp('admin-owner');
      const admin = await signUp('admin-user');
      const { property } = await createProperty(owner.organizationId, 'admin-owner');
      const gateway = await manufacture('admin');

      await prisma.membership.create({
        data: { userId: admin.userId, organizationId: owner.organizationId, role: 'ADMIN' },
      });

      await claim(admin.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(200);
    });

    it('stops accepting a token once the account is disabled', async () => {
      const owner = await signUp('disabled');
      const { property } = await createProperty(owner.organizationId, 'disabled');
      const gateway = await manufacture('disabled');
      await prisma.user.update({ where: { email: owner.email }, data: { status: 'DISABLED' } });

      await claim(owner.token, {
        serialNumber: gateway.serialNumber,
        propertyId: property.id,
      }).expect(401);
    });
  });

  describe('input validation', () => {
    let token: string;
    let propertyId: string;

    beforeAll(async () => {
      const owner = await signUp('validation');
      token = owner.token;
      propertyId = (await createProperty(owner.organizationId, 'validation')).property.id;
    });

    it.each([
      ['a missing serial number', { serialNumber: undefined }],
      ['a missing property', { propertyId: undefined }],
      ['an empty serial number', { serialNumber: '' }],
      ['a serial number with illegal characters', { serialNumber: 'VG100 0001; DROP' }],
      ['a serial number that is too long', { serialNumber: 'V'.repeat(65) }],
      ['a non-string serial number', { serialNumber: 12345 }],
      ['a non-string property', { propertyId: { id: 'x' } }],
      ['an unknown field', { unexpected: true }],
      ['an empty name', { name: '' }],
    ])('rejects %s with 400', async (_label, override) => {
      await claim(token, {
        serialNumber: 'VG100-valid-serial',
        propertyId,
        ...override,
      }).expect(400);
    });

    it('rejects an unauthenticated malformed request without validating it', async () => {
      // Authentication runs before validation, so an anonymous caller cannot
      // use 400-versus-401 to probe the request schema.
      await claim(undefined, { nonsense: true }).expect(401);
    });
  });

  describe('manufacturing registration', () => {
    it('creates an unclaimed gateway that can then be claimed', async () => {
      // The registration path and the claim path have to agree, or a
      // manufactured unit would arrive in a state nobody can claim.
      const owner = await signUp('registered');
      const { property } = await createProperty(owner.organizationId, 'registered');
      const serialNumber = `VG100-${unique('reg')}`.slice(0, 64);

      const registered = await app.get(GatewaysService).register({ serialNumber });
      createdGatewayIds.push(registered.id);

      expect(registered).toMatchObject({
        serialNumber,
        status: 'UNCLAIMED',
        propertyId: null,
        roomId: null,
        name: serialNumber,
      });

      const response = await claim(owner.token, { serialNumber, propertyId: property.id }).expect(
        200,
      );

      expect(response.body.id).toBe(registered.id);
      expect(response.body.status).toBe('OFFLINE');
    });

    it('refuses to register a serial number twice', async () => {
      // Re-running a manufacturing batch must not reset a claimed gateway.
      const serialNumber = `VG100-${unique('reg-dupe')}`.slice(0, 64);
      const gateways = app.get(GatewaysService);

      const first = await gateways.register({ serialNumber });
      createdGatewayIds.push(first.id);

      await expect(gateways.register({ serialNumber })).rejects.toThrow();
    });
  });
});
