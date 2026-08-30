import { Prisma } from '@prisma/client';

import { PrismaService } from '../src/database/prisma.service';

/**
 * Exercises constraints that only a real database enforces: cascade
 * behaviour, unique indexes, and referential integrity. Mocks cannot
 * demonstrate any of these.
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
    '\n  DATABASE_URL is not set: skipping database integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

describeWithDb('database schema (integration)', () => {
  const prisma = new PrismaService();
  /** Organizations created by a test, torn down afterwards. */
  const createdOrganizationIds: string[] = [];

  async function createHierarchy(label: string) {
    const organization = await prisma.organization.create({ data: { name: `Org ${label}` } });
    createdOrganizationIds.push(organization.id);

    const property = await prisma.property.create({
      data: { organizationId: organization.id, name: `Villa ${label}` },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: `Bedroom ${label}` },
    });

    return { organization, property, room };
  }

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (createdOrganizationIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
    }
    await prisma.$disconnect();
  });

  it('answers a probe query', async () => {
    await expect(prisma.isReachable()).resolves.toBe(true);
  });

  it('persists the documented hierarchy', async () => {
    const { organization, property, room } = await createHierarchy('hierarchy');

    const loaded = await prisma.organization.findUniqueOrThrow({
      where: { id: organization.id },
      include: { properties: { include: { rooms: true } } },
    });

    expect(loaded.properties).toHaveLength(1);
    expect(loaded.properties[0]?.id).toBe(property.id);
    expect(loaded.properties[0]?.rooms[0]?.id).toBe(room.id);
  });

  it('defaults a new gateway to unclaimed and never seen', async () => {
    const { property } = await createHierarchy('gateway-default');

    const gateway = await prisma.gateway.create({
      data: { propertyId: property.id, serialNumber: `SN-${Date.now()}-a`, name: 'Hall gateway' },
    });

    expect(gateway.status).toBe('UNCLAIMED');
    expect(gateway.lastSeenAt).toBeNull();
    expect(gateway.roomId).toBeNull();
    expect(gateway.firmwareVersion).toBeNull();
  });

  it('rejects a duplicate gateway serial number', async () => {
    const { property } = await createHierarchy('serial-dupe');
    const serialNumber = `SN-${Date.now()}-dupe`;

    await prisma.gateway.create({ data: { propertyId: property.id, serialNumber, name: 'First' } });

    await expect(
      prisma.gateway.create({ data: { propertyId: property.id, serialNumber, name: 'Second' } }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects importing the same provider device into one property twice', async () => {
    const { property } = await createHierarchy('device-dupe');
    const data = {
      propertyId: property.id,
      name: 'Bedroom AC',
      type: 'CLIMATE',
      platform: 'TUYA',
      externalId: 'tuya-device-1',
      capabilities: ['POWER', 'TARGET_TEMPERATURE'],
    } satisfies Prisma.DeviceUncheckedCreateInput;

    await prisma.device.create({ data: { ...data } });

    await expect(prisma.device.create({ data: { ...data } })).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('allows the same provider device in a different property', async () => {
    const { property: first } = await createHierarchy('same-device-a');
    const { property: second } = await createHierarchy('same-device-b');
    const data = {
      name: 'Shared model',
      type: 'LIGHT',
      platform: 'TUYA',
      externalId: 'tuya-shared-1',
      capabilities: ['POWER'],
    } satisfies Omit<Prisma.DeviceUncheckedCreateInput, 'propertyId'>;

    await prisma.device.create({ data: { ...data, propertyId: first.id } });

    await expect(
      prisma.device.create({ data: { ...data, propertyId: second.id } }),
    ).resolves.toMatchObject({ externalId: 'tuya-shared-1' });
  });

  it('rejects a duplicate room name within a property', async () => {
    const { property, room } = await createHierarchy('room-dupe');

    await expect(
      prisma.room.create({ data: { propertyId: property.id, name: room.name } }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects a device pointing at a property that does not exist', async () => {
    await expect(
      prisma.device.create({
        data: {
          propertyId: 'does-not-exist',
          name: 'Orphan',
          type: 'SWITCH',
          platform: 'TUYA',
          externalId: 'tuya-orphan',
          capabilities: ['POWER'],
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('cascades a property delete to its rooms, gateways, and devices', async () => {
    const { property, room } = await createHierarchy('cascade');
    const gateway = await prisma.gateway.create({
      data: {
        propertyId: property.id,
        roomId: room.id,
        serialNumber: `SN-${Date.now()}-cascade`,
        name: 'Gateway',
      },
    });
    const device = await prisma.device.create({
      data: {
        propertyId: property.id,
        roomId: room.id,
        name: 'Lamp',
        type: 'LIGHT',
        platform: 'TUYA',
        externalId: 'tuya-cascade-1',
        capabilities: ['POWER', 'BRIGHTNESS'],
      },
    });

    await prisma.property.delete({ where: { id: property.id } });

    await expect(prisma.room.findUnique({ where: { id: room.id } })).resolves.toBeNull();
    await expect(prisma.gateway.findUnique({ where: { id: gateway.id } })).resolves.toBeNull();
    await expect(prisma.device.findUnique({ where: { id: device.id } })).resolves.toBeNull();
  });

  it('unassigns rather than deletes when a room is removed', async () => {
    const { property, room } = await createHierarchy('room-delete');
    const gateway = await prisma.gateway.create({
      data: {
        propertyId: property.id,
        roomId: room.id,
        serialNumber: `SN-${Date.now()}-unassign`,
        name: 'Gateway',
      },
    });
    const device = await prisma.device.create({
      data: {
        propertyId: property.id,
        roomId: room.id,
        name: 'Lamp',
        type: 'LIGHT',
        platform: 'TUYA',
        externalId: 'tuya-unassign-1',
        capabilities: ['POWER'],
      },
    });

    await prisma.room.delete({ where: { id: room.id } });

    // Losing a room must not destroy hardware records or imported devices.
    await expect(prisma.gateway.findUnique({ where: { id: gateway.id } })).resolves.toMatchObject({
      id: gateway.id,
      roomId: null,
    });
    await expect(prisma.device.findUnique({ where: { id: device.id } })).resolves.toMatchObject({
      id: device.id,
      roomId: null,
    });
  });

  it('stores capabilities as an ordered enum array', async () => {
    const { property } = await createHierarchy('capabilities');

    const device = await prisma.device.create({
      data: {
        propertyId: property.id,
        name: 'Bedroom AC',
        type: 'CLIMATE',
        platform: 'TUYA',
        externalId: 'tuya-caps-1',
        capabilities: ['POWER', 'TARGET_TEMPERATURE', 'HVAC_MODE', 'FAN_SPEED'],
      },
    });

    expect(device.capabilities).toEqual(['POWER', 'TARGET_TEMPERATURE', 'HVAC_MODE', 'FAN_SPEED']);
  });
});
