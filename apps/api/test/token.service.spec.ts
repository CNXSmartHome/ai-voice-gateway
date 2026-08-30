import { JwtService } from '@nestjs/jwt';

import type { AuthConfig } from '../src/auth/auth-config';
import { TokenService } from '../src/auth/token.service';

const CONFIG: AuthConfig = {
  secret: 'unit-test-secret-of-adequate-length',
  issuer: 'vg-test',
  accessTtlSeconds: 900,
};

function serviceWith(config: AuthConfig = CONFIG): TokenService {
  const jwt = new JwtService({
    secret: config.secret,
    signOptions: { algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  });

  return new TokenService(jwt, config);
}

/** Reads the payload of a JWT without verifying it. */
function decodePayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64').toString('utf8')) as Record<string, unknown>;
}

describe('TokenService', () => {
  const tokens = serviceWith();

  describe('issueAccessToken', () => {
    it('reports the token type and lifetime', () => {
      const issued = tokens.issueAccessToken('user_1');

      expect(issued.tokenType).toBe('Bearer');
      expect(issued.expiresInSeconds).toBe(CONFIG.accessTtlSeconds);
    });

    it('carries the user id, issuer, and an expiry', () => {
      const claims = tokens.verifyAccessToken(tokens.issueAccessToken('user_1').accessToken);

      expect(claims).toMatchObject({ sub: 'user_1', iss: CONFIG.issuer });
      expect(claims?.exp).toBeGreaterThan(claims?.iat ?? 0);
    });

    it('sets the expiry to the configured TTL', () => {
      const claims = tokens.verifyAccessToken(tokens.issueAccessToken('user_1').accessToken);

      expect((claims?.exp ?? 0) - (claims?.iat ?? 0)).toBe(CONFIG.accessTtlSeconds);
    });

    it('gives every token a distinct id', () => {
      // A revocation list (a later task) needs something to key on that is
      // not the whole token.
      const first = tokens.verifyAccessToken(tokens.issueAccessToken('user_1').accessToken);
      const second = tokens.verifyAccessToken(tokens.issueAccessToken('user_1').accessToken);

      expect(first?.jti).toBeDefined();
      expect(first?.jti).not.toBe(second?.jti);
    });

    it('carries no email, name, or role', () => {
      // A JWT is signed, not encrypted: anything here is readable by whoever
      // holds the token, and a copied role goes stale the moment it changes.
      const payload = decodePayload(tokens.issueAccessToken('user_1').accessToken);

      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'jti', 'sub']);
    });

    it('signs with HS256', () => {
      const header = tokens.issueAccessToken('user_1').accessToken.split('.')[0] ?? '';
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
        alg: string;
      };

      expect(decoded.alg).toBe('HS256');
    });
  });

  describe('verifyAccessToken', () => {
    it('accepts a token it issued', () => {
      expect(
        tokens.verifyAccessToken(tokens.issueAccessToken('user_1').accessToken),
      ).not.toBeNull();
    });

    it('rejects a token signed with a different secret', () => {
      const other = serviceWith({ ...CONFIG, secret: 'a-completely-different-signing-secret' });

      expect(tokens.verifyAccessToken(other.issueAccessToken('user_1').accessToken)).toBeNull();
    });

    it('rejects a token issued for a different issuer', () => {
      const other = serviceWith({ ...CONFIG, issuer: 'someone-else' });

      expect(tokens.verifyAccessToken(other.issueAccessToken('user_1').accessToken)).toBeNull();
    });

    it('rejects an expired token', () => {
      const shortLived = serviceWith({ ...CONFIG, accessTtlSeconds: 1 });
      const token = shortLived.issueAccessToken('user_1').accessToken;

      // Move past the expiry rather than waiting for it.
      jest.useFakeTimers().setSystemTime(Date.now() + 5000);
      try {
        expect(shortLived.verifyAccessToken(token)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects a token whose payload has been altered', () => {
      const token = tokens.issueAccessToken('user_1').accessToken;
      const [header, payload, signature] = token.split('.') as [string, string, string];

      const tampered = Buffer.from(
        JSON.stringify({ ...decodePayload(token), sub: 'user_2' }),
        'utf8',
      )
        .toString('base64url')
        .replace(/=+$/, '');

      expect(tampered).not.toBe(payload);
      expect(tokens.verifyAccessToken(`${header}.${tampered}.${signature}`)).toBeNull();
    });

    it.each([
      ['empty', ''],
      ['not a JWT', 'not-a-token'],
      ['too few segments', 'aaa.bbb'],
      ['empty signature', 'aaa.bbb.'],
      ['unsigned "alg: none"', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyXzEifQ.'],
    ])('rejects a malformed token (%s)', (_label, token) => {
      expect(tokens.verifyAccessToken(token)).toBeNull();
    });
  });
});
