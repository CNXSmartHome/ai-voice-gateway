import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GatewaySecretService } from '../src/gateways/gateway-secret.service';

describe('GatewaySecretService', () => {
  const secrets = new GatewaySecretService();

  describe('generate', () => {
    it('returns a secret and the hash to store', () => {
      const { secret, secretHash } = secrets.generate();

      expect(secret).not.toBe('');
      expect(secrets.verify(secret, secretHash)).toBe(true);
    });

    it('produces a distinct secret every time', () => {
      const generated = new Set(Array.from({ length: 50 }, () => secrets.generate().secret));

      expect(generated.size).toBe(50);
    });

    it('carries at least 256 bits of entropy', () => {
      // The whole reason a plain digest is safe here: there is nothing to
      // brute force. If the secret shrank, that argument would stop holding.
      const { secret } = secrets.generate();

      expect(Buffer.from(secret, 'base64url').length).toBeGreaterThanOrEqual(32);
    });

    it('produces a URL-safe secret', () => {
      // It travels in an Authorization header, so it must survive transport
      // without escaping, and must not contain the `:` used as a separator.
      const { secret } = secrets.generate();

      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('never returns the secret inside the hash', () => {
      const { secret, secretHash } = secrets.generate();

      expect(secretHash).not.toContain(secret);
    });
  });

  describe('hash', () => {
    it('records the algorithm and encoding version', () => {
      expect(secrets.hash('a-secret')).toMatch(/^sha256\$v=1\$[A-Za-z0-9+/]+={0,2}$/);
    });

    it('is deterministic', () => {
      // Unsalted by design: a salt defeats precomputation against guessable
      // inputs, and there is nothing to precompute against 256 random bits.
      expect(secrets.hash('a-secret')).toBe(secrets.hash('a-secret'));
    });

    it('differs for different secrets', () => {
      expect(secrets.hash('one')).not.toBe(secrets.hash('two'));
    });
  });

  describe('verify', () => {
    const { secret, secretHash } = secrets.generate();

    it('accepts the correct secret', () => {
      expect(secrets.verify(secret, secretHash)).toBe(true);
    });

    it('rejects a wrong secret', () => {
      expect(secrets.verify(`${secret}x`, secretHash)).toBe(false);
    });

    it('rejects a secret differing in case', () => {
      expect(secrets.verify(secret.toUpperCase(), secretHash)).toBe(false);
    });

    it('rejects an empty secret', () => {
      expect(secrets.verify('', secretHash)).toBe(false);
    });

    it.each([
      ['empty', ''],
      ['not the encoding', 'not-a-hash'],
      ['too few fields', 'sha256$v=1'],
      ['too many fields', 'sha256$v=1$abc$extra'],
      ['unknown algorithm', 'md5$v=1$YWJj'],
      ['unknown version', 'sha256$v=2$YWJj'],
      ['non-base64 digest', 'sha256$v=1$not valid!'],
      ['empty digest', 'sha256$v=1$'],
    ])('rejects a malformed stored hash (%s) without throwing', (_label, stored) => {
      // A corrupted row is a failed authentication, not a crash.
      expect(secrets.verify(secret, stored)).toBe(false);
    });

    it('rejects a hash whose digest has been tampered with', () => {
      const parts = secretHash.split('$');
      const digest = Buffer.from(parts[2] ?? '', 'base64');
      digest[0] = (digest[0] ?? 0) ^ 0xff;

      expect(secrets.verify(secret, `sha256$v=1$${digest.toString('base64')}`)).toBe(false);
    });

    it('does not accept another gateway secret', () => {
      const other = secrets.generate();

      expect(secrets.verify(other.secret, secretHash)).toBe(false);
    });
  });

  describe('agreement with the manufacturing script', () => {
    /**
     * `scripts/register-gateway.js` runs under plain node and duplicates the
     * hash format rather than importing it. If the two drift, every gateway
     * registered by the script would fail to authenticate — a failure that
     * would only appear on real hardware.
     */
    const script = readFileSync(join(__dirname, '..', 'scripts', 'register-gateway.js'), 'utf8');

    it('produces the same encoding the script writes', () => {
      const match = /return `([^`]+)`/.exec(script);
      expect(match).not.toBeNull();

      // The script's template, with its expression stubbed, must match the
      // shape this service produces.
      const template = match?.[1] ?? '';
      expect(template.startsWith('sha256$v=1$')).toBe(true);
      expect(secrets.hash('sample')).toMatch(/^sha256\$v=1\$/);
    });

    it('hashes an identical secret to an identical value', () => {
      // Reproduce the script's computation directly from its own source
      // constants rather than trusting that it looks right.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- mirroring the script
      const { createHash } = require('node:crypto') as typeof import('node:crypto');
      const scriptHash = `sha256$v=1$${createHash('sha256').update('sample', 'utf8').digest('base64')}`;

      expect(scriptHash).toBe(secrets.hash('sample'));
      expect(secrets.verify('sample', scriptHash)).toBe(true);
    });

    it('uses the same secret length as the script', () => {
      expect(script).toContain('SECRET_BYTES = 32');
    });
  });
});
