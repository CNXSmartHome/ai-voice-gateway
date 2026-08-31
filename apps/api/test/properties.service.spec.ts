import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import type { PrismaService } from '../src/database/prisma.service';
import { CLAIM_ROLES } from '../src/gateways/gateways.service';
import { PropertiesService, PROPERTY_WRITE_ROLES } from '../src/properties/properties.service';

const ORGANIZATION = 'org_1';
const OTHER_ORGANIZATION = 'org_2';

const PROPERTY_ROW = {
  id: 'prop_1',
  organizationId: ORGANIZATION,
  name: 'Villa One',
  timezone: 'Asia/Bangkok',
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
  updatedAt: new Date('2026-08-30T10:00:00.000Z'),
};

function caller(role: string, organizationId = ORGANIZATION): AuthenticatedUser {
  return {
    id: 'user_1',
    email: 'owner@example.com',
    name: 'Owner',
    memberships: [{ organizationId, role }],
  };
}

/** A caller in two organizations, only one of which they administer. */
function callerInTwo(): AuthenticatedUser {
  return {
    id: 'user_1',
    email: 'owner@example.com',
    name: 'Owner',
    memberships: [
      { organizationId: ORGANIZATION, role: 'OWNER' },
      { organizationId: OTHER_ORGANIZATION, role: 'MEMBER' },
    ],
  };
}

function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma error ${code}`), { code });
}

describe('PROPERTY_WRITE_ROLES', () => {
  /*
   * The two lists are separate declarations with separate reasoning, and they
   * are supposed to agree: defining where hardware lives and attaching
   * hardware to it are the same kind of administrative act. If a later task
   * changes one, this fails, and the divergence becomes a decision rather
   * than something nobody noticed.
   */
  it('agrees with the roles VG-005 requires to claim a gateway', () => {
    expect([...PROPERTY_WRITE_ROLES].sort()).toEqual([...CLAIM_ROLES].sort());
  });

  it('excludes MEMBER, the role for residents and guests', () => {
    expect(PROPERTY_WRITE_ROLES).not.toContain('MEMBER');
  });
});

describe('PropertiesService', () => {
  let create: jest.Mock;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let updateMany: jest.Mock;
  let findUniqueOrThrow: jest.Mock;
  let transaction: jest.Mock;
  let service: PropertiesService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(PROPERTY_ROW);
    findUnique = jest.fn().mockResolvedValue(PROPERTY_ROW);
    findMany = jest.fn().mockResolvedValue([PROPERTY_ROW]);
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    findUniqueOrThrow = jest.fn().mockResolvedValue(PROPERTY_ROW);

    // Runs the callback, so the guarded write inside the transaction is
    // exercised rather than stubbed past.
    transaction = jest
      .fn()
      .mockImplementation((run: (tx: unknown) => unknown) =>
        run({ property: { updateMany, findUniqueOrThrow } }),
      );

    service = new PropertiesService({
      property: { create, findUnique, findMany },
      $transaction: transaction,
    } as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a property in an organization the caller administers', async () => {
      const view = await service.create(caller('OWNER'), {
        organizationId: ORGANIZATION,
        name: 'Villa One',
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { organizationId: ORGANIZATION, name: 'Villa One' },
        }),
      );
      expect(view).toEqual({
        id: 'prop_1',
        organizationId: ORGANIZATION,
        name: 'Villa One',
        timezone: 'Asia/Bangkok',
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T10:00:00.000Z',
      });
    });

    it('writes only the organization and the name', async () => {
      // The timezone column exists and is left to its schema default: setting
      // it is not part of this task.
      await service.create(caller('ADMIN'), { organizationId: ORGANIZATION, name: 'Villa' });

      expect(create.mock.calls[0]?.[0]?.data).toEqual({
        organizationId: ORGANIZATION,
        name: 'Villa',
      });
    });

    /*
     * A caller who is not in the organization has no way to know it exists,
     * and this endpoint must not become the way. One who is in it already
     * knows -- they are a member -- so a 404 would only mislead.
     */
    it('answers an organization the caller cannot see with a 404', async () => {
      await expect(
        service.create(caller('OWNER'), { organizationId: 'org_unknown', name: 'Villa' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(create).not.toHaveBeenCalled();
    });

    it('answers a member of the organization with a 403', async () => {
      await expect(
        service.create(caller('MEMBER'), { organizationId: ORGANIZATION, name: 'Villa' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
    });

    it('reports a duplicate name plainly', async () => {
      // Nothing to hide: the caller can already list their own properties.
      create.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.create(caller('OWNER'), { organizationId: ORGANIZATION, name: 'Villa One' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('treats an organization deleted since sign-in as one it cannot see', async () => {
      create.mockRejectedValue(prismaError('P2003'));

      await expect(
        service.create(caller('OWNER'), { organizationId: ORGANIZATION, name: 'Villa' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not swallow an error it was not written for', async () => {
      create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.create(caller('OWNER'), { organizationId: ORGANIZATION, name: 'Villa' }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('list', () => {
    it('scopes the query to the memberships the guard loaded', async () => {
      // Not to anything the caller supplied: there is no parameter to tamper
      // with, so there is nothing to get wrong.
      await service.list(callerInTwo());

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: { in: [ORGANIZATION, OTHER_ORGANIZATION] } },
        }),
      );
    });

    it('includes organizations the caller is only a MEMBER of', async () => {
      // Reading is not administering. A resident can see where they live.
      await service.list(caller('MEMBER'));

      expect(findMany.mock.calls[0]?.[0]?.where).toEqual({
        organizationId: { in: [ORGANIZATION] },
      });
    });

    it('returns an empty list for a caller with no memberships, without querying', async () => {
      const orphan: AuthenticatedUser = {
        id: 'user_2',
        email: 'nobody@example.com',
        name: 'Nobody',
        memberships: [],
      };

      await expect(service.list(orphan)).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('orders deterministically', async () => {
      await service.list(caller('OWNER'));

      expect(findMany.mock.calls[0]?.[0]?.orderBy).toEqual([
        { organizationId: 'asc' },
        { name: 'asc' },
      ]);
    });
  });

  describe('get', () => {
    it('returns a property in the caller organization', async () => {
      await expect(service.get(caller('MEMBER'), 'prop_1')).resolves.toMatchObject({
        id: 'prop_1',
      });
    });

    it('answers a property in another organization exactly as a missing one', async () => {
      const foreign = await service
        .get(caller('OWNER', OTHER_ORGANIZATION), 'prop_1')
        .catch((error: unknown) => error);

      findUnique.mockResolvedValue(null);
      const missing = await service.get(caller('OWNER'), 'prop_1').catch((error: unknown) => error);

      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect((foreign as NotFoundException).message).toBe((missing as NotFoundException).message);
    });
  });

  describe('update', () => {
    it('renames a property', async () => {
      const view = await service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' });

      expect(updateMany.mock.calls[0]?.[0]?.data).toEqual({ name: 'Villa Two' });
      expect(view).toMatchObject({ id: 'prop_1' });
    });

    /*
     * Authorization is decided from a row read a moment earlier, and a
     * property can be moved to another organization in between. Carrying the
     * authorized organization into the write means a property the caller was
     * never authorized for cannot be modified by a request that was.
     */
    it('carries the organization it authorized against into the write', async () => {
      await service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' });

      expect(updateMany.mock.calls[0]?.[0]?.where).toEqual({
        id: 'prop_1',
        organizationId: ORGANIZATION,
      });
    });

    it('refuses when the guarded write matches nothing, as if the property were gone', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('returns the row read back inside the transaction, not the one it authorized from', async () => {
      // The update holds a lock on the row until commit, so this read is the
      // authoritative result rather than a second guess at it.
      await service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prop_1' } }),
      );
    });

    it('never moves a property between organizations', async () => {
      await service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' });

      expect(updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('organizationId');
    });

    it('answers a property the caller cannot see with a 404', async () => {
      await expect(
        service.update(caller('OWNER', OTHER_ORGANIZATION), 'prop_1', { name: 'Mine now' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('answers a property the caller can read but not administer with a 403', async () => {
      await expect(
        service.update(caller('MEMBER'), 'prop_1', { name: 'Villa Two' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('reports a duplicate name plainly', async () => {
      updateMany.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.update(caller('OWNER'), 'prop_1', { name: 'Villa One' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('treats a property deleted between the read and the write as missing', async () => {
      updateMany.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
