import { NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import type { PrismaService } from '../src/database/prisma.service';
import { CLAIM_ROLES, GatewaysService } from '../src/gateways/gateways.service';

/**
 * Covers the decisions the database cannot make: who may claim, which
 * rejections are indistinguishable, and that the claim is issued as a
 * status-guarded update rather than a create. The same paths run against a
 * real database in gateways.integration-spec.ts.
 */
describe('GatewaysService', () => {
  const NOW = new Date('2026-08-30T00:00:00.000Z');

  const CLAIMED_ROW = {
    id: 'gw_1',
    serialNumber: 'VG100-0001',
    name: 'VG100-0001',
    status: 'OFFLINE',
    propertyId: 'prop_1',
    roomId: null,
    firmwareVersion: null,
    lastSeenAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  function caller(memberships: { organizationId: string; role: string }[]): AuthenticatedUser {
    return { id: 'user_1', email: 'owner@example.com', name: 'Owner', memberships };
  }

  const OWNER = caller([{ organizationId: 'org_1', role: 'OWNER' }]);

  let propertyFindUnique: jest.Mock;
  let roomFindUnique: jest.Mock;
  let gatewayUpdateMany: jest.Mock;
  let gatewayFindUniqueOrThrow: jest.Mock;
  let gatewayCreate: jest.Mock;
  let service: GatewaysService;

  beforeEach(() => {
    propertyFindUnique = jest.fn().mockResolvedValue({ id: 'prop_1', organizationId: 'org_1' });
    roomFindUnique = jest.fn().mockResolvedValue({ propertyId: 'prop_1' });
    gatewayUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    gatewayFindUniqueOrThrow = jest.fn().mockResolvedValue(CLAIMED_ROW);
    gatewayCreate = jest.fn().mockResolvedValue(CLAIMED_ROW);

    const tx = {
      property: { findUnique: propertyFindUnique },
      room: { findUnique: roomFindUnique },
      gateway: {
        updateMany: gatewayUpdateMany,
        findUniqueOrThrow: gatewayFindUniqueOrThrow,
        create: gatewayCreate,
      },
    };

    service = new GatewaysService({
      $transaction: (callback: (client: unknown) => unknown) => callback(tx),
      gateway: { create: gatewayCreate },
    } as unknown as PrismaService);
  });

  const INPUT = { serialNumber: 'VG100-0001', propertyId: 'prop_1' };

  describe('a successful claim', () => {
    it('returns the claimed gateway', async () => {
      const gateway = await service.claim(OWNER, INPUT);

      expect(gateway).toMatchObject({
        id: 'gw_1',
        serialNumber: 'VG100-0001',
        status: 'OFFLINE',
        propertyId: 'prop_1',
      });
    });

    it('claims the existing row rather than creating one', async () => {
      // The hardware identity is set at manufacture. A create here would
      // mint a second row for the same physical device.
      await service.claim(OWNER, INPUT);

      expect(gatewayCreate).not.toHaveBeenCalled();
      expect(gatewayUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('guards the update on the whole persisted pre-claim state', async () => {
      // The status guard is what makes a concurrent claim safe: the loser
      // matches zero rows instead of taking the gateway from the winner.
      //
      // The ownership columns are in the predicate for a different reason.
      // The schema cannot express "UNCLAIMED implies no property", so a row
      // that drifted into UNCLAIMED while still owned would otherwise match
      // and be transferred to whoever claimed it next. Written out literally
      // rather than reusing the constant, so a change to it fails here.
      await service.claim(OWNER, INPUT);

      expect(gatewayUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
        serialNumber: 'VG100-0001',
        status: 'UNCLAIMED',
        propertyId: null,
        roomId: null,
      });
    });

    it('sets the property and the status in one statement', async () => {
      // Two statements would leave a window where the gateway has an owner
      // but still reads as unclaimed.
      await service.claim(OWNER, INPUT);

      expect(gatewayUpdateMany.mock.calls[0]?.[0]?.data).toMatchObject({
        propertyId: 'prop_1',
        status: 'OFFLINE',
      });
    });

    it('claims as OFFLINE, not ONLINE', async () => {
      // Ownership is recorded; the hardware has not connected. VG-006's
      // heartbeat is what makes it online.
      await service.claim(OWNER, INPUT);

      expect(gatewayUpdateMany.mock.calls[0]?.[0]?.data?.status).toBe('OFFLINE');
    });

    it('leaves the name alone when the caller does not supply one', async () => {
      await service.claim(OWNER, INPUT);

      expect(gatewayUpdateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('name');
    });

    it('applies a supplied name', async () => {
      await service.claim(OWNER, { ...INPUT, name: 'Hall gateway' });

      expect(gatewayUpdateMany.mock.calls[0]?.[0]?.data?.name).toBe('Hall gateway');
    });

    it('assigns a room in the same property', async () => {
      await service.claim(OWNER, { ...INPUT, roomId: 'room_1' });

      expect(gatewayUpdateMany.mock.calls[0]?.[0]?.data?.roomId).toBe('room_1');
    });

    it('runs the whole claim inside one transaction', async () => {
      const transaction = jest.fn((callback: (client: unknown) => unknown) =>
        callback({
          property: { findUnique: propertyFindUnique },
          room: { findUnique: roomFindUnique },
          gateway: {
            updateMany: gatewayUpdateMany,
            findUniqueOrThrow: gatewayFindUniqueOrThrow,
          },
        }),
      );

      await new GatewaysService({ $transaction: transaction } as unknown as PrismaService).claim(
        OWNER,
        INPUT,
      );

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('authorization', () => {
    it.each(CLAIM_ROLES)('allows a %s of the owning organization', async (role) => {
      await expect(
        service.claim(caller([{ organizationId: 'org_1', role }]), INPUT),
      ).resolves.toMatchObject({ id: 'gw_1' });
    });

    it('refuses a MEMBER of the owning organization', async () => {
      // Residents and guests use a gateway; they do not attach hardware.
      await expect(
        service.claim(caller([{ organizationId: 'org_1', role: 'MEMBER' }]), INPUT),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a caller with no memberships at all', async () => {
      await expect(service.claim(caller([]), INPUT)).rejects.toThrow(NotFoundException);
    });

    it('refuses an owner of a different organization', async () => {
      await expect(
        service.claim(caller([{ organizationId: 'org_2', role: 'OWNER' }]), INPUT),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not attempt the claim when authorization fails', async () => {
      // Otherwise the endpoint would still probe serial numbers for a caller
      // who cannot see the property.
      await expect(service.claim(caller([]), INPUT)).rejects.toThrow(NotFoundException);

      expect(gatewayUpdateMany).not.toHaveBeenCalled();
    });

    it('matches the role against the right organization', async () => {
      // An ADMIN somewhere else plus a MEMBER here must not add up to a
      // permitted claim.
      const mixed = caller([
        { organizationId: 'org_2', role: 'ADMIN' },
        { organizationId: 'org_1', role: 'MEMBER' },
      ]);

      await expect(service.claim(mixed, INPUT)).rejects.toThrow(NotFoundException);
    });
  });

  describe('rejections are indistinguishable', () => {
    async function messageFor(run: () => Promise<unknown>): Promise<string> {
      return run().then(
        () => 'did not reject',
        (error: Error) => error.message,
      );
    }

    it('reports the same message for every reason', async () => {
      const unknownSerial = await messageFor(() => {
        gatewayUpdateMany.mockResolvedValue({ count: 0 });
        return service.claim(OWNER, INPUT);
      });

      const missingProperty = await messageFor(() => {
        propertyFindUnique.mockResolvedValue(null);
        return service.claim(OWNER, INPUT);
      });

      const foreignProperty = await messageFor(() => {
        propertyFindUnique.mockResolvedValue({ id: 'prop_1', organizationId: 'org_9' });
        return service.claim(OWNER, INPUT);
      });

      const wrongRoom = await messageFor(() => {
        propertyFindUnique.mockResolvedValue({ id: 'prop_1', organizationId: 'org_1' });
        roomFindUnique.mockResolvedValue({ propertyId: 'prop_other' });
        return service.claim(OWNER, { ...INPUT, roomId: 'room_1' });
      });

      // A serial that exists and one that does not must look the same, or
      // the endpoint enumerates the manufacturing run.
      expect(new Set([unknownSerial, missingProperty, foreignProperty, wrongRoom]).size).toBe(1);
    });

    it('names neither the serial number nor the property in the message', async () => {
      gatewayUpdateMany.mockResolvedValue({ count: 0 });

      const message = await messageFor(() => service.claim(OWNER, INPUT));

      expect(message).not.toContain('VG100-0001');
      expect(message).not.toContain('prop_1');
    });

    it.each([
      ['a foreign key violation', 'P2003'],
      ['a vanished row', 'P2025'],
    ])('maps %s during the update to the same rejection', async (_label, code) => {
      // The property was there a moment ago and is gone now. That must not
      // surface as a 500 carrying schema detail.
      gatewayUpdateMany.mockRejectedValue(Object.assign(new Error('fk'), { code }));

      await expect(service.claim(OWNER, INPUT)).rejects.toThrow(NotFoundException);
    });

    it('lets an unrelated database error surface', async () => {
      // Mapping everything to 404 would hide real faults behind a plausible
      // business rejection.
      gatewayUpdateMany.mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(service.claim(OWNER, INPUT)).rejects.toThrow('connection lost');
    });

    it('rejects an already-claimed gateway', async () => {
      // The status guard matched nothing, because the row is not UNCLAIMED.
      gatewayUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.claim(OWNER, INPUT)).rejects.toThrow(NotFoundException);
    });

    it('rejects a room that belongs to another property', async () => {
      roomFindUnique.mockResolvedValue({ propertyId: 'prop_other' });

      await expect(service.claim(OWNER, { ...INPUT, roomId: 'room_1' })).rejects.toThrow(
        NotFoundException,
      );
      expect(gatewayUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects a room that does not exist', async () => {
      roomFindUnique.mockResolvedValue(null);

      await expect(service.claim(OWNER, { ...INPUT, roomId: 'room_1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not look up a room when none is supplied', async () => {
      await service.claim(OWNER, INPUT);

      expect(roomFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('creates an unclaimed gateway named after its serial by default', async () => {
      await service.register({ serialNumber: 'VG100-0002' });

      expect(gatewayCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { serialNumber: 'VG100-0002', name: 'VG100-0002' },
        }),
      );
    });

    it('accepts a name', async () => {
      await service.register({ serialNumber: 'VG100-0002', name: 'Batch A' });

      expect(gatewayCreate.mock.calls[0]?.[0]?.data?.name).toBe('Batch A');
    });

    it('sets no property, so the row is claimable', async () => {
      // The status default in the schema is UNCLAIMED; supplying a property
      // here would produce a gateway nobody can claim.
      await service.register({ serialNumber: 'VG100-0002' });

      expect(gatewayCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty('propertyId');
      expect(gatewayCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty('status');
    });
  });
});
