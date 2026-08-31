import type { ApiClient } from './client';
import { ApiError } from './errors';

/**
 * Sign-in against the VG-004 endpoints.
 *
 * The response is parsed rather than cast. A TypeScript type is a compile-time
 * claim about a value that arrives over a network at runtime, and the two are
 * only related by hope; every field the app depends on is checked here so a
 * contract change shows up as one clear failure instead of an undefined
 * halfway through a screen.
 */

export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface Membership {
  readonly organizationId: string;
  readonly role: MembershipRole;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly memberships: readonly Membership[];
}

export interface SignInResult {
  readonly accessToken: string;
  readonly tokenType: string;
  /** Seconds, as returned by the API. */
  readonly expiresIn: number;
  readonly user: AuthenticatedUser;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

const ROLES: readonly MembershipRole[] = ['OWNER', 'ADMIN', 'MEMBER'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new ApiError('unexpected', `The server response is missing "${key}".`);
  }
  return value;
}

function parseMembership(value: unknown): Membership {
  if (!isRecord(value)) {
    throw new ApiError('unexpected', 'The server returned a malformed membership.');
  }
  const role = value.role;
  if (typeof role !== 'string' || !ROLES.includes(role as MembershipRole)) {
    throw new ApiError('unexpected', 'The server returned an unknown membership role.');
  }
  return { organizationId: requireString(value, 'organizationId'), role: role as MembershipRole };
}

export function parseSignInResult(body: unknown): SignInResult {
  if (!isRecord(body)) {
    throw new ApiError('unexpected', 'The server returned an unexpected response.');
  }

  const user = body.user;
  if (!isRecord(user)) {
    throw new ApiError('unexpected', 'The server response is missing "user".');
  }

  const memberships = user.memberships;
  if (!Array.isArray(memberships)) {
    throw new ApiError('unexpected', 'The server response is missing "memberships".');
  }

  const expiresIn = body.expiresIn;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new ApiError('unexpected', 'The server returned an unusable token lifetime.');
  }

  return {
    accessToken: requireString(body, 'accessToken'),
    tokenType: requireString(body, 'tokenType'),
    expiresIn,
    user: {
      id: requireString(user, 'id'),
      email: requireString(user, 'email'),
      name: requireString(user, 'name'),
      memberships: memberships.map(parseMembership),
    },
  };
}

export async function signIn(client: ApiClient, credentials: Credentials): Promise<SignInResult> {
  const body = await client.request({
    method: 'POST',
    path: '/v1/auth/login',
    body: { email: credentials.email, password: credentials.password },
  });
  return parseSignInResult(body);
}
