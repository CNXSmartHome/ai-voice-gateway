import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, REQUEST_USER_KEY } from '../src/auth/auth.constants';
import type { AuthService } from '../src/auth/auth.service';
import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import type { TokenService } from '../src/auth/token.service';

const USER: AuthenticatedUser = {
  id: 'user_1',
  email: 'owner@example.com',
  name: 'Owner',
  memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
};

interface Harness {
  guard: JwtAuthGuard;
  request: Record<string, unknown>;
  context: ExecutionContext;
  verifyAccessToken: jest.Mock;
  findActiveUser: jest.Mock;
}

function harness(options: {
  publicMetadata?: unknown;
  headers?: Record<string, unknown>;
}): Harness {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options.publicMetadata);

  const verifyAccessToken = jest.fn().mockReturnValue({ sub: USER.id, jti: 'jti_1' });
  const findActiveUser = jest.fn().mockResolvedValue(USER);

  const request: Record<string, unknown> = { headers: options.headers ?? {} };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;

  const guard = new JwtAuthGuard(
    reflector,
    { verifyAccessToken } as unknown as TokenService,
    { findActiveUser } as unknown as AuthService,
  );

  return { guard, request, context, verifyAccessToken, findActiveUser };
}

function bearer(token = 'a.valid.token'): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('JwtAuthGuard', () => {
  describe('public routes', () => {
    it('admits a route marked public without looking at the header', async () => {
      const { guard, context, verifyAccessToken } = harness({ publicMetadata: true });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('reads the public marker from both the handler and the controller', async () => {
      const reflector = new Reflector();
      const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const context = {
        switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
        getHandler: () => 'handler',
        getClass: () => 'class',
      } as unknown as ExecutionContext;

      await new JwtAuthGuard(
        reflector,
        {} as unknown as TokenService,
        {} as unknown as AuthService,
      ).canActivate(context);

      expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, ['handler', 'class']);
    });

    it.each<[string, unknown]>([
      ['absent', undefined],
      ['null', null],
      ['the string "true"', 'true'],
      ['the number 1', 1],
      ['false', false],
    ])('treats metadata that is %s as protected, not public', async (_label, metadata) => {
      // Only a literal `true` opts a route out. Anything else — including a
      // truthy value of the wrong type — must fail closed.
      const { guard, context } = harness({ publicMetadata: metadata });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('protected routes', () => {
    it('admits a request carrying a valid token', async () => {
      const { guard, context, request } = harness({ headers: bearer() });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request[REQUEST_USER_KEY]).toEqual(USER);
    });

    it('accepts the scheme case-insensitively', async () => {
      // RFC 7235 defines the scheme as case-insensitive; clients do vary.
      const { guard, context } = harness({ headers: { authorization: 'bearer a.valid.token' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('passes the token through verbatim', async () => {
      const { guard, context, verifyAccessToken } = harness({ headers: bearer('  padded  ') });

      await guard.canActivate(context);

      // Trimming here would repair a malformed credential into a valid one.
      expect(verifyAccessToken).toHaveBeenCalledWith('  padded  ');
    });

    it.each([
      ['no headers object', {}],
      ['no authorization header', { headers: {} }],
      ['empty header', { headers: { authorization: '' } }],
      ['scheme only', { headers: { authorization: 'Bearer' } }],
      ['scheme with no token', { headers: { authorization: 'Bearer ' } }],
      ['a different scheme', { headers: { authorization: 'Basic abc123' } }],
      ['a non-string header', { headers: { authorization: ['Bearer a.b.c'] } }],
    ])('rejects a request with %s', async (_label, requestShape) => {
      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const verifyAccessToken = jest.fn();
      const context = {
        switchToHttp: () => ({ getRequest: () => requestShape }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as unknown as ExecutionContext;

      const guard = new JwtAuthGuard(
        reflector,
        { verifyAccessToken } as unknown as TokenService,
        {} as unknown as AuthService,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a token that does not verify', async () => {
      const { guard, context, verifyAccessToken, findActiveUser } = harness({
        headers: bearer(),
      });
      verifyAccessToken.mockReturnValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(findActiveUser).not.toHaveBeenCalled();
    });

    it('rejects a valid token whose user no longer exists or is disabled', async () => {
      // Disabling an account must take effect on the next request, not when
      // the token happens to expire.
      const { guard, context, findActiveUser } = harness({ headers: bearer() });
      findActiveUser.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('does not attach a user when it rejects', async () => {
      const { guard, context, request, findActiveUser } = harness({ headers: bearer() });
      findActiveUser.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(request[REQUEST_USER_KEY]).toBeUndefined();
    });

    it('looks the user up by the token subject', async () => {
      const { guard, context, verifyAccessToken, findActiveUser } = harness({
        headers: bearer(),
      });
      verifyAccessToken.mockReturnValue({ sub: 'user_42', jti: 'jti_1' });

      await guard.canActivate(context);

      expect(findActiveUser).toHaveBeenCalledWith('user_42');
    });
  });
});
