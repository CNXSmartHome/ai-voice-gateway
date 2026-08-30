import {
  DEFAULT_ACCESS_TTL_SECONDS,
  DEFAULT_ISSUER,
  MINIMUM_SECRET_LENGTH,
  loadAuthConfig,
} from '../src/auth/auth-config';

const STRONG_SECRET = 'a'.repeat(MINIMUM_SECRET_LENGTH);

describe('loadAuthConfig', () => {
  it('reads the secret, issuer, and TTL from the environment', () => {
    const config = loadAuthConfig({
      JWT_SECRET: STRONG_SECRET,
      JWT_ISSUER: 'vg-test',
      JWT_ACCESS_TTL_SECONDS: '900',
    });

    expect(config).toEqual({ secret: STRONG_SECRET, issuer: 'vg-test', accessTtlSeconds: 900 });
  });

  it('applies defaults for the issuer and TTL', () => {
    const config = loadAuthConfig({ JWT_SECRET: STRONG_SECRET });

    expect(config.issuer).toBe(DEFAULT_ISSUER);
    expect(config.accessTtlSeconds).toBe(DEFAULT_ACCESS_TTL_SECONDS);
  });

  it.each(['', '   '])('treats a blank issuer (%p) as unset', (issuer) => {
    expect(loadAuthConfig({ JWT_SECRET: STRONG_SECRET, JWT_ISSUER: issuer }).issuer).toBe(
      DEFAULT_ISSUER,
    );
  });

  describe('in production', () => {
    const production = { NODE_ENV: 'production' };

    it('refuses to start without a secret', () => {
      expect(() => loadAuthConfig(production)).toThrow(/JWT_SECRET is required in production/);
    });

    it.each([
      ['blank', ''],
      ['whitespace only', '    '],
    ])('refuses to start with a %s secret', (_label, secret) => {
      // A whitespace secret is not a secret; treating it as one would start
      // the API with an effectively empty key.
      expect(() => loadAuthConfig({ ...production, JWT_SECRET: secret })).toThrow(
        /JWT_SECRET is required in production/,
      );
    });

    it('refuses a secret shorter than the minimum', () => {
      expect(() =>
        loadAuthConfig({ ...production, JWT_SECRET: 'a'.repeat(MINIMUM_SECRET_LENGTH - 1) }),
      ).toThrow(/at least 32 characters/);
    });

    it('never puts the secret or a prefix of it in the error', () => {
      const secret = 'short-but-recognisable-secret';

      try {
        loadAuthConfig({ ...production, JWT_SECRET: secret });
        throw new Error('expected loadAuthConfig to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain(secret.slice(0, 8));
      }
    });

    it('accepts a secret at exactly the minimum length', () => {
      expect(loadAuthConfig({ ...production, JWT_SECRET: STRONG_SECRET }).secret).toBe(
        STRONG_SECRET,
      );
    });
  });

  describe('outside production', () => {
    it('generates an ephemeral secret when none is configured', () => {
      // A developer can run the API with no configuration; the generated
      // secret cannot be committed and does not survive a restart.
      const config = loadAuthConfig({ NODE_ENV: 'development' });

      expect(config.secret.length).toBeGreaterThanOrEqual(MINIMUM_SECRET_LENGTH);
    });

    it('generates a different secret on each load', () => {
      const first = loadAuthConfig({ NODE_ENV: 'development' }).secret;
      const second = loadAuthConfig({ NODE_ENV: 'development' }).secret;

      // If these matched, a predictable value would be standing in for a
      // secret, which is what the production rule exists to prevent.
      expect(first).not.toBe(second);
    });

    it('still prefers a configured secret', () => {
      expect(loadAuthConfig({ NODE_ENV: 'test', JWT_SECRET: STRONG_SECRET }).secret).toBe(
        STRONG_SECRET,
      );
    });
  });

  describe('TTL validation', () => {
    it.each(['0', '-1', 'abc', '1.5'])('rejects %p', (ttl) => {
      expect(() =>
        loadAuthConfig({ JWT_SECRET: STRONG_SECRET, JWT_ACCESS_TTL_SECONDS: ttl }),
      ).toThrow(/JWT_ACCESS_TTL_SECONDS must be a positive integer/);
    });

    it('accepts a positive integer', () => {
      expect(
        loadAuthConfig({ JWT_SECRET: STRONG_SECRET, JWT_ACCESS_TTL_SECONDS: '60' })
          .accessTtlSeconds,
      ).toBe(60);
    });
  });
});
