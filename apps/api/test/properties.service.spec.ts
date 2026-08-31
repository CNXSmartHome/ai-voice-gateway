import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import type { PrismaService } from '../src/database/prisma.service';
import { CLAIM_ROLES } from '../src/gateways/gateways.service';
import { isValidTimezone } from '../src/properties/dto/is-timezone.validator';
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

describe('isValidTimezone', () => {
  it('accepts IANA zones', () => {
    expect(isValidTimezone('Asia/Bangkok')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('rejects anything the runtime does not know', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('GMT+7')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(7)).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
  });
});

describe('PropertiesService', () => {
  let create: jest.Mock;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let update: jest.Mock;
  let service: PropertiesService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(PROPERTY_ROW);
    findUnique = jest.fn().mockResolvedValue(PROPERTY_ROW);
    findMany = jest.fn().mockResolvedValue([PROPERTY_ROW]);
    update = jest.fn().mockResolvedValue(PROPERTY_ROW);

    service = new PropertiesService({
      property: { create, findUnique, findMany, update },
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

    it('leaves the timezone to the schema default when none is given', async () => {
      await service.create(caller('ADMIN'), { organizationId: ORGANIZATION, name: 'Villa' });

      expect(create.mock.calls[0]?.[0]?.data).not.toHaveProperty('timezone');
    });

    it('passes a supplied timezone through', async () => {
      await service.create(caller('OWNER'), {
        organizationId: ORGANIZATION,
        name: 'Villa',
        timezone: 'Asia/Bangkok',
      });

      expect(create.mock.calls[0]?.[0]?.data?.timezone).toBe('Asia/Bangkok');
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
      await service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prop_1' }, data: { name: 'Villa Two' } }),
      );
    });

    it('changes only what was asked for', async () => {
      await service.update(caller('OWNER'), 'prop_1', { timezone: 'UTC' });

      expect(update.mock.calls[0]?.[0]?.data).toEqual({ timezone: 'UTC' });
    });

    it('refuses a change that changes nothing', async () => {
      // Reporting success for having done nothing is worse than a 400: it
      // reads as "renamed" to a client that sent the wrong field name.
      await expect(service.update(caller('OWNER'), 'prop_1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('never moves a property between organizations', async () => {
      await service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two', timezone: 'UTC' });

      expect(update.mock.calls[0]?.[0]?.data).not.toHaveProperty('organizationId');
    });

    it('answers a property the caller cannot see with a 404', async () => {
      await expect(
        service.update(caller('OWNER', OTHER_ORGANIZATION), 'prop_1', { name: 'Mine now' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    });

    it('answers a property the caller can read but not administer with a 403', async () => {
      await expect(
        service.update(caller('MEMBER'), 'prop_1', { name: 'Villa Two' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    });

    it('reports a duplicate name plainly', async () => {
      update.mockRejectedValue(prismaError('P2002'));

      await expect(
        service.update(caller('OWNER'), 'prop_1', { name: 'Villa One' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('treats a property deleted between the read and the write as missing', async () => {
      update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.update(caller('OWNER'), 'prop_1', { name: 'Villa Two' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
