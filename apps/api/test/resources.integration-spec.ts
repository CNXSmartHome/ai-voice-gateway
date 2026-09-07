import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';
import { HomeAssistantStubAdapter } from '../src/resources/adapters/home-assistant-stub.adapter';
import { ControlService } from '../src/resources/control.service';
import { ResourceRegistryService } from '../src/resources/resource-registry.service';

/**
 * The registry and control pipeline against a real database (VG-040).
 *
 * The unit tests establish the rules; these establish that the queries behind
 * them are actually scoped -- ambiguity, tenant isolation, and the uniqueness
 * constraints are properties of the schema, and no mock can demonstrate them.
 *
 * Requires DATABASE_URL. CI provides a PostgreSQL service container; see
 * `docs/CI.md`. Without it the suite is skipped rather than failing.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console -- visibility matters more than lint here
  console.warn(
    '\n  DATABASE_URL is not set: skipping resource registry integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

const PASSWORD = 'a-sufficiently-long-password';

describeWithDb('resource registry and control pipeline (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: ResourceRegistryService;
  let control: ControlService;
  let adapter: HomeAssistantStubAdapter;

  const createdEmails: string[] = [];
  let sequence = 0;

  function unique(label: string): string {
    sequence += 1;
    return `${label}-${String(Date.now())}-${String(sequence)}`;
  }

  /** Registers an account and returns a caller shaped as the guard would build it. */
  async function signUp(label: string, role = 'OWNER') {
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
      user: { id: string; name: string; memberships: { organizationId: string }[] };
    };
    const organizationId = body.user.memberships[0]?.organizationId ?? '';

    const caller: AuthenticatedUser = {
      id: body.user.id,
      email,
      name: body.user.name,
      memberships: [{ organizationId, role }],
    };

    return { caller, organizationId };
  }

  async function createProperty(organizationId: string, label: string) {
    const property = await prisma.property.create({
      data: { organizationId, name: `Villa ${unique(label)}` },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: `Zone ${unique(label)}` },
    });

    return { property, room };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    registry = app.get(ResourceRegistryService);
    control = app.get(ControlService);
    adapter = app.get(HomeAssistantStubAdapter);
  });

  beforeEach(() => {
    adapter.dispatched.length = 0;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: createdEmails } },
      select: { memberships: { select: { organizationId: true } } },
    });
    const organizationIds = users.flatMap((user) =>
      user.memberships.map((membership) => membership.organizationId),
    );
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    // Cascades to properties, rooms, resources, and their bindings.
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await app.close();
  });

  describe('registration', () => {
    it('registers a resource against a villa and a zone', async () => {
      const { caller, organizationId } = await signUp('register');
      const { property, room } = await createProperty(organizationId, 'register');

      const view = await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Ceiling Light',
        kind: 'light',
        capabilities: ['power', 'brightness'],
        platform: 'home_assistant',
        externalId: 'light.ceiling',
      });

      expect(view).toMatchObject({
        propertyId: property.id,
        roomId: room.id,
        name: 'Ceiling Light',
        kind: 'light',
        capabilities: ['power', 'brightness'],
        enabled: true,
      });
    });

    it('persists the binding without exposing it', async () => {
      const { caller, organizationId } = await signUp('binding');
      const { property, room } = await createProperty(organizationId, 'binding');

      const view = await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Lamp',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.secret_entity',
      });

      // Written...
      const stored = await prisma.resourceBinding.findUnique({
        where: { resourceId: view.id },
      });
      expect(stored?.externalId).toBe('light.secret_entity');

      // ...but not readable through any public method.
      expect(JSON.stringify(view)).not.toContain('light.secret_entity');
      expect(JSON.stringify(await registry.get(caller, view.id))).not.toContain(
        'light.secret_entity',
      );
      expect(JSON.stringify(await registry.list(caller))).not.toContain('light.secret_entity');
    });

    it('rejects a capability the kind cannot have', async () => {
      const { caller, organizationId } = await signUp('cap');
      const { property } = await createProperty(organizationId, 'cap');

      await expect(
        registry.register(caller, {
          propertyId: property.id,
          name: 'Curtain',
          kind: 'curtain',
          capabilities: ['brightness'],
          platform: 'home_assistant',
          externalId: 'cover.curtain',
        }),
      ).rejects.toThrow(/does not support/);
    });

    it('rejects a zone belonging to another villa', async () => {
      const { caller, organizationId } = await signUp('zone');
      const { property } = await createProperty(organizationId, 'zone-a');
      const { room: foreignRoom } = await createProperty(organizationId, 'zone-b');

      await expect(
        registry.register(caller, {
          propertyId: property.id,
          roomId: foreignRoom.id,
          name: 'Light',
          kind: 'light',
          capabilities: ['power'],
          platform: 'home_assistant',
          externalId: 'light.misplaced',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to register the same provider device into one villa twice', async () => {
      const { caller, organizationId } = await signUp('dupe');
      const { property, room } = await createProperty(organizationId, 'dupe');

      const base = {
        propertyId: property.id,
        roomId: room.id,
        kind: 'light' as const,
        capabilities: ['power'] as const,
        platform: 'home_assistant' as const,
        externalId: 'light.same_entity',
      };

      await registry.register(caller, { ...base, name: 'First' });
      await expect(registry.register(caller, { ...base, name: 'Second' })).rejects.toThrow(
        /already registered/,
      );
    });

    it('lets two villas bind the same entity id, because they are different installations', async () => {
      const { caller, organizationId } = await signUp('two-villas');
      const a = await createProperty(organizationId, 'villa-a');
      const b = await createProperty(organizationId, 'villa-b');

      const base = {
        name: 'Kitchen Light',
        kind: 'light' as const,
        capabilities: ['power'] as const,
        platform: 'home_assistant' as const,
        // The archetypal Home Assistant entity id: unique per installation only.
        externalId: 'light.kitchen',
      };

      await registry.register(caller, { ...base, propertyId: a.property.id, roomId: a.room.id });
      await expect(
        registry.register(caller, { ...base, propertyId: b.property.id, roomId: b.room.id }),
      ).resolves.toMatchObject({ propertyId: b.property.id });
    });

    it('refuses a MEMBER, for whom registration is not an administrative right', async () => {
      const { caller, organizationId } = await signUp('member', 'MEMBER');
      const { property } = await createProperty(organizationId, 'member');

      await expect(
        registry.register(caller, {
          propertyId: property.id,
          name: 'Light',
          kind: 'light',
          capabilities: ['power'],
          platform: 'home_assistant',
          externalId: 'light.member',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('tenant isolation', () => {
    it('refuses to control a resource in another organization', async () => {
      const owner = await signUp('iso-owner');
      const outsider = await signUp('iso-outsider');
      const { property, room } = await createProperty(owner.organizationId, 'iso');

      await registry.register(owner.caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Ceiling Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.isolated',
      });

      await expect(
        control.control(
          outsider.caller,
          { propertyId: property.id, name: 'Ceiling Light' },
          { capability: 'power', value: true },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(adapter.dispatched).toHaveLength(0);
    });

    it("does not list or read another organization's resources", async () => {
      const owner = await signUp('read-owner');
      const outsider = await signUp('read-outsider');
      const { property, room } = await createProperty(owner.organizationId, 'read');

      const view = await registry.register(owner.caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Private Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.private',
      });

      expect(await registry.list(outsider.caller)).toHaveLength(0);
      await expect(registry.get(outsider.caller, view.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resolution', () => {
    it('resolves a name within a zone and dispatches to the bound platform', async () => {
      const { caller, organizationId } = await signUp('resolve');
      const { property, room } = await createProperty(organizationId, 'resolve');

      await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Ceiling Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.resolved',
      });

      const outcome = await control.control(
        caller,
        { propertyId: property.id, roomId: room.id, name: 'ceiling light' },
        { capability: 'power', value: true },
      );

      expect(outcome.status).toBe('DISPATCHED');
      expect(adapter.dispatched).toEqual([
        { externalId: 'light.resolved', capability: 'power', value: true },
      ]);
    });

    it('reports NOT_FOUND for a name nothing matches', async () => {
      const { caller, organizationId } = await signUp('missing');
      const { property } = await createProperty(organizationId, 'missing');

      const outcome = await control.control(
        caller,
        { propertyId: property.id, name: 'No Such Light' },
        { capability: 'power', value: true },
      );

      expect(outcome).toEqual({ status: 'UNRESOLVED', reason: 'NOT_FOUND', matched: 0 });
      expect(adapter.dispatched).toHaveLength(0);
    });

    it('reports AMBIGUOUS rather than choosing between two zones', async () => {
      const { caller, organizationId } = await signUp('ambiguous');
      const { property, room } = await createProperty(organizationId, 'ambiguous');
      const secondRoom = await prisma.room.create({
        data: { propertyId: property.id, name: `Zone ${unique('ambiguous-2')}` },
      });

      for (const [index, roomId] of [room.id, secondRoom.id].entries()) {
        await registry.register(caller, {
          propertyId: property.id,
          roomId,
          name: 'Ceiling Light',
          kind: 'light',
          capabilities: ['power'],
          platform: 'home_assistant',
          externalId: `light.ambiguous_${String(index)}`,
        });
      }

      // Villa-wide: two zones each have a "Ceiling Light", and nothing the
      // caller said distinguishes them.
      const outcome = await control.control(
        caller,
        { propertyId: property.id, name: 'Ceiling Light' },
        { capability: 'power', value: true },
      );

      expect(outcome).toEqual({ status: 'UNRESOLVED', reason: 'AMBIGUOUS', matched: 2 });
      expect(adapter.dispatched).toHaveLength(0);
    });

    it('resolves the same target once a zone narrows it', async () => {
      const { caller, organizationId } = await signUp('narrow');
      const { property, room } = await createProperty(organizationId, 'narrow');
      const secondRoom = await prisma.room.create({
        data: { propertyId: property.id, name: `Zone ${unique('narrow-2')}` },
      });

      for (const [index, roomId] of [room.id, secondRoom.id].entries()) {
        await registry.register(caller, {
          propertyId: property.id,
          roomId,
          name: 'Ceiling Light',
          kind: 'light',
          capabilities: ['power'],
          platform: 'home_assistant',
          externalId: `light.narrow_${String(index)}`,
        });
      }

      const outcome = await control.control(
        caller,
        { propertyId: property.id, roomId: secondRoom.id, name: 'Ceiling Light' },
        { capability: 'power', value: true },
      );

      expect(outcome.status).toBe('DISPATCHED');
      expect(adapter.dispatched).toEqual([
        { externalId: 'light.narrow_1', capability: 'power', value: true },
      ]);
    });

    it('reports DISABLED, which is not the same answer as NOT_FOUND', async () => {
      const { caller, organizationId } = await signUp('disabled');
      const { property, room } = await createProperty(organizationId, 'disabled');

      const view = await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Broken Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.broken',
      });
      await registry.setEnabled(caller, view.id, false);

      const outcome = await control.control(
        caller,
        { propertyId: property.id, name: 'Broken Light' },
        { capability: 'power', value: true },
      );

      expect(outcome).toEqual({ status: 'UNRESOLVED', reason: 'DISABLED', matched: 1 });
      expect(adapter.dispatched).toHaveLength(0);
    });

    it('does not let a disabled twin create ambiguity', async () => {
      const { caller, organizationId } = await signUp('twin');
      const { property, room } = await createProperty(organizationId, 'twin');
      const secondRoom = await prisma.room.create({
        data: { propertyId: property.id, name: `Zone ${unique('twin-2')}` },
      });

      const disabled = await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Ceiling Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.twin_disabled',
      });
      await registry.setEnabled(caller, disabled.id, false);

      await registry.register(caller, {
        propertyId: property.id,
        roomId: secondRoom.id,
        name: 'Ceiling Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.twin_enabled',
      });

      const outcome = await control.control(
        caller,
        { propertyId: property.id, name: 'Ceiling Light' },
        { capability: 'power', value: true },
      );

      expect(outcome.status).toBe('DISPATCHED');
      expect(adapter.dispatched).toEqual([
        { externalId: 'light.twin_enabled', capability: 'power', value: true },
      ]);
    });
  });

  describe('policy', () => {
    it('holds a scene at confirmation and dispatches nothing', async () => {
      const { caller, organizationId } = await signUp('scene');
      const { property, room } = await createProperty(organizationId, 'scene');

      await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Evening',
        kind: 'scene',
        capabilities: ['execute'],
        platform: 'home_assistant',
        externalId: 'scene.evening',
      });

      const outcome = await control.control(
        caller,
        { propertyId: property.id, name: 'Evening' },
        { capability: 'execute', value: true },
      );

      expect(outcome).toMatchObject({
        status: 'CONFIRMATION_REQUIRED',
        reason: 'IRREVERSIBLE_ACTION',
      });
      expect(adapter.dispatched).toHaveLength(0);
    });

    it('refuses an undeclared capability before reaching the adapter', async () => {
      const { caller, organizationId } = await signUp('undeclared');
      const { property, room } = await createProperty(organizationId, 'undeclared');

      await registry.register(caller, {
        propertyId: property.id,
        roomId: room.id,
        name: 'Plain Light',
        kind: 'light',
        capabilities: ['power'],
        platform: 'home_assistant',
        externalId: 'light.plain',
      });

      const outcome = await control.control(
        caller,
        { propertyId: property.id, name: 'Plain Light' },
        { capability: 'brightness', value: 50 },
      );

      expect(outcome).toMatchObject({
        status: 'REFUSED',
        decision: 'DENY',
        reason: 'CAPABILITY_NOT_DECLARED',
      });
      expect(adapter.dispatched).toHaveLength(0);
    });
  });
});
