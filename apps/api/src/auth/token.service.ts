import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AUTH_CONFIG } from './auth.constants';
import type { AuthConfig } from './auth-config';

/** Claims carried by an access token. */
export interface AccessTokenClaims {
  /** User id. */
  readonly sub: string;
  /** Token id, so a future revocation list has something to key on. */
  readonly jti: string;
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
}

export interface IssuedToken {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresInSeconds: number;
}

/**
 * Issues and verifies access tokens.
 *
 * The payload carries the user id and nothing else identifying. Email, name,
 * and role are deliberately absent: a JWT is signed but not encrypted, so
 * anything placed here is readable by anyone holding the token, and a role
 * copied into a token goes stale the moment it changes in the database.
 * Callers that need those read them through `AuthService`.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  issueAccessToken(userId: string): IssuedToken {
    const accessToken = this.jwt.sign(
      { jti: randomUUID() },
      {
        subject: userId,
        issuer: this.config.issuer,
        expiresIn: this.config.accessTtlSeconds,
      },
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: this.config.accessTtlSeconds,
    };
  }

  /**
   * Verifies a token and returns its claims, or null if it is not valid.
   *
   * Every failure — bad signature, expiry, wrong issuer, malformed input —
   * collapses to null. The caller turns that into one generic 401, so the
   * response never explains *why* a token was rejected.
   */
  verifyAccessToken(token: string): AccessTokenClaims | null {
    try {
      const claims = this.jwt.verify<AccessTokenClaims>(token, {
        issuer: this.config.issuer,
        // Reject a token that omits an expiry rather than treating it as
        // valid forever.
        ignoreExpiration: false,
      });

      if (typeof claims.sub !== 'string' || claims.sub === '') return null;
      if (typeof claims.exp !== 'number') return null;

      return claims;
    } catch {
      return null;
    }
  }
}
