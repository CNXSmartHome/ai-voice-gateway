import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

import type { AuthenticatedUser } from './authenticated-user';
import { PasswordService } from './password.service';
import { TokenService, type IssuedToken } from './token.service';

/** What the caller may see about themselves. Never includes the hash. */
export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly memberships: readonly { organizationId: string; role: string }[];
}

export interface AuthenticationResult {
  readonly token: IssuedToken;
  readonly user: UserProfile;
}

/**
 * Selects the columns a caller may see.
 *
 * Written as an explicit allow-list rather than deleting `passwordHash` from
 * a full row: a column added to `User` later is excluded by default instead
 * of leaking until someone remembers to filter it.
 */
const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  memberships: { select: { organizationId: true, role: true } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Creates an organization, its first user, and an owner membership.
   *
   * All three are written in one transaction. A partial account — a user with
   * no organization, or an organization with no owner — would be unusable and
   * would block the address from registering again.
   */
  async register(input: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }): Promise<AuthenticationResult> {
    const email = normalizeEmail(input.email);

    // Hash before opening the transaction: it is the slow step, and holding a
    // transaction open across it would pin a connection for its duration.
    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma
      .$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: input.organizationName },
        });

        return tx.user.create({
          data: {
            email,
            passwordHash,
            name: input.name,
            memberships: { create: { organizationId: organization.id, role: 'OWNER' } },
          },
          select: PROFILE_SELECT,
        });
      })
      .catch((error: unknown) => {
        // The unique index on email is what actually decides this, so a
        // concurrent duplicate registration is rejected too — a check-then-
        // insert would let both through.
        if (isUniqueConstraintViolation(error)) {
          throw new ConflictException('Registration could not be completed.');
        }
        throw error;
      });

    return { token: this.tokens.issueAccessToken(user.id), user: toProfile(user) };
  }

  /**
   * Exchanges credentials for an access token.
   *
   * Every failure is the same rejection. An unknown address, a wrong
   * password, and a disabled account are indistinguishable to the caller, in
   * both the response and — because `spendVerificationWork` runs when no user
   * matches — roughly the time taken.
   */
  async login(input: { email: string; password: string }): Promise<AuthenticationResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      select: { ...PROFILE_SELECT, passwordHash: true, status: true },
    });

    if (user === null) {
      await this.passwords.spendVerificationWork(input.password);
      throw new UnauthorizedException('Invalid credentials.');
    }

    const passwordMatches = await this.passwords.verify(input.password, user.passwordHash);
    if (!passwordMatches || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const profile = toProfile(user);
    return { token: this.tokens.issueAccessToken(profile.id), user: profile };
  }

  /**
   * Loads the user behind a verified token, or null if they may not act.
   *
   * The status check lives here rather than in the guard so that disabling an
   * account takes effect on the next request, without waiting for the token
   * to expire.
   */
  async findActiveUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...PROFILE_SELECT, status: true },
    });

    if (user === null || user.status !== 'ACTIVE') return null;

    return toProfile(user);
  }
}

/**
 * Copies out exactly the fields a caller may see.
 *
 * Rebuilding the object field by field, rather than deleting the hash from a
 * loaded row, means a column added to `User` later cannot reach a response
 * by accident.
 */
function toProfile(user: {
  id: string;
  email: string;
  name: string;
  memberships: { organizationId: string; role: string }[];
}): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    memberships: user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
    })),
  };
}

/**
 * Normalizes an address for storage and lookup.
 *
 * Only case and surrounding whitespace are normalized. Provider-specific
 * rules — that Gmail ignores dots, for instance — are deliberately not
 * applied: they differ per provider, and guessing wrong silently merges two
 * distinct accounts.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Prisma reports a unique index violation as P2002. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
