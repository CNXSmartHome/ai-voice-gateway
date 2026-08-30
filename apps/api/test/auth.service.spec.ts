import { ConflictException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from '../src/auth/auth.service';
import type { PasswordService } from '../src/auth/password.service';
import type { TokenService } from '../src/auth/token.service';
import type { PrismaService } from '../src/database/prisma.service';

/**
 * Covers the logic the database cannot: which errors are raised, what work is
 * spent on a failed login, and what leaves the service. The same paths run
 * against a real database in auth.integration-spec.ts.
 */
describe('AuthService', () => {
  const STORED = {
    id: 'user_1',
    email: 'owner@example.com',
    name: 'Owner',
    memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
    passwordHash: 'scrypt$v=1$n=65536,r=8,p=2$c2FsdA==$aGFzaA==',
    status: 'ACTIVE',
  };

  let findUnique: jest.Mock;
  let organizationCreate: jest.Mock;
  let userCreate: jest.Mock;
  let verify: jest.Mock;
  let spendVerificationWork: jest.Mock;
  let issueAccessToken: jest.Mock;
  let service: AuthService;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue(null);
    organizationCreate = jest.fn().mockResolvedValue({ id: 'org_1', name: 'Org' });
    userCreate = jest.fn().mockResolvedValue({
      id: STORED.id,
      email: STORED.email,
      name: STORED.name,
      memberships: STORED.memberships,
    });
    verify = jest.fn().mockResolvedValue(true);
    spendVerificationWork = jest.fn().mockResolvedValue(false);
    issueAccessToken = jest
      .fn()
      .mockReturnValue({ accessToken: 'token', tokenType: 'Bearer', expiresInSeconds: 900 });

    const prisma = {
      user: { findUnique },
      $transaction: (callback: (tx: unknown) => unknown) =>
        callback({ organization: { create: organizationCreate }, user: { create: userCreate } }),
    } as unknown as PrismaService;

    service = new AuthService(
      prisma,
      {
        hash: jest.fn().mockResolvedValue('hashed'),
        verify,
        spendVerificationWork,
      } as unknown as PasswordService,
      { issueAccessToken } as unknown as TokenService,
    );
  });

  const REGISTRATION = {
    email: 'Owner@Example.COM ',
    password: 'a-sufficiently-long-password',
    name: 'Owner',
    organizationName: 'Org',
  };

  describe('register', () => {
    it('normalizes the address before storing it', async () => {
      await service.register(REGISTRATION);

      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'owner@example.com' }) }),
      );
    });

    it('stores a hash, never the password', async () => {
      await service.register(REGISTRATION);

      const data = userCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data.passwordHash).toBe('hashed');
      expect(JSON.stringify(data)).not.toContain(REGISTRATION.password);
    });

    it('makes the first user an owner of the new organization', async () => {
      await service.register(REGISTRATION);

      const data = userCreate.mock.calls[0]?.[0]?.data as {
        memberships: { create: { organizationId: string; role: string } };
      };
      expect(data.memberships.create).toEqual({ organizationId: 'org_1', role: 'OWNER' });
    });

    it('creates the organization and user in one transaction', async () => {
      // Both writes go through the transaction callback; a partial account
      // would be unusable and would block the address from registering again.
      await service.register(REGISTRATION);

      expect(organizationCreate).toHaveBeenCalledTimes(1);
      expect(userCreate).toHaveBeenCalledTimes(1);
    });

    it('turns a unique-constraint violation into a conflict', async () => {
      // The database decides this, not a prior existence check, so two
      // concurrent registrations cannot both succeed.
      userCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.register(REGISTRATION)).rejects.toThrow(ConflictException);
    });

    it('does not name the address in the conflict message', async () => {
      userCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.register(REGISTRATION)).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining('owner@example.com') as unknown as string,
        }),
      );
    });

    it('lets an unrelated database error surface', async () => {
      // Mapping every failure to 409 would hide real faults behind a
      // plausible-looking business error.
      userCreate.mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'P1001' }));

      await expect(service.register(REGISTRATION)).rejects.toThrow('connection lost');
    });

    it('returns no password material', async () => {
      const result = await service.register(REGISTRATION);

      expect(JSON.stringify(result)).not.toMatch(/passwordHash|scrypt\$/);
      expect(Object.keys(result.user).sort()).toEqual(['email', 'id', 'memberships', 'name']);
    });
  });

  describe('login', () => {
    const CREDENTIALS = { email: 'owner@example.com', password: 'a-sufficiently-long-password' };

    beforeEach(() => {
      findUnique.mockResolvedValue(STORED);
    });

    it('issues a token for valid credentials', async () => {
      const result = await service.login(CREDENTIALS);

      expect(issueAccessToken).toHaveBeenCalledWith(STORED.id);
      expect(result.token.accessToken).toBe('token');
    });

    it('looks the user up by the normalized address', async () => {
      await service.login({ ...CREDENTIALS, email: ' OWNER@example.com ' });

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'owner@example.com' } }),
      );
    });

    it('rejects a wrong password', async () => {
      verify.mockResolvedValue(false);

      await expect(service.login(CREDENTIALS)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a disabled account', async () => {
      findUnique.mockResolvedValue({ ...STORED, status: 'DISABLED' });

      await expect(service.login(CREDENTIALS)).rejects.toThrow(UnauthorizedException);
    });

    it('does not issue a token for a disabled account whose password is right', async () => {
      findUnique.mockResolvedValue({ ...STORED, status: 'DISABLED' });

      await expect(service.login(CREDENTIALS)).rejects.toThrow(UnauthorizedException);
      expect(issueAccessToken).not.toHaveBeenCalled();
    });

    it('spends hashing work when no account matches', async () => {
      // Without this, an unknown address returns measurably faster than a
      // known one, which is enough to enumerate accounts.
      findUnique.mockResolvedValue(null);

      await expect(service.login(CREDENTIALS)).rejects.toThrow(UnauthorizedException);
      expect(spendVerificationWork).toHaveBeenCalledWith(CREDENTIALS.password);
    });

    it('reports the same message whether the account exists or not', async () => {
      const known = await service.login(CREDENTIALS).catch((error: Error) => error.message);
      verify.mockResolvedValue(false);
      const wrongPassword = await service.login(CREDENTIALS).catch((error: Error) => error.message);
      findUnique.mockResolvedValue(null);
      const unknown = await service.login(CREDENTIALS).catch((error: Error) => error.message);

      expect(known).not.toBe(wrongPassword); // the valid login succeeded
      expect(unknown).toBe(wrongPassword);
    });

    it('returns no password material', async () => {
      const result = await service.login(CREDENTIALS);

      expect(JSON.stringify(result)).not.toMatch(/passwordHash|scrypt\$/);
      expect(Object.keys(result.user).sort()).toEqual(['email', 'id', 'memberships', 'name']);
    });
  });

  describe('findActiveUser', () => {
    it('returns the user when active', async () => {
      findUnique.mockResolvedValue(STORED);

      await expect(service.findActiveUser('user_1')).resolves.toMatchObject({ id: 'user_1' });
    });

    it('returns null for an unknown user', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findActiveUser('user_1')).resolves.toBeNull();
    });

    it('returns null for a disabled user', async () => {
      findUnique.mockResolvedValue({ ...STORED, status: 'DISABLED' });

      await expect(service.findActiveUser('user_1')).resolves.toBeNull();
    });

    it('never includes password material', async () => {
      findUnique.mockResolvedValue(STORED);

      const user = await service.findActiveUser('user_1');

      expect(Object.keys(user ?? {}).sort()).toEqual(['email', 'id', 'memberships', 'name']);
    });
  });
});
