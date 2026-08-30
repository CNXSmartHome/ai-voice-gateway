import { PasswordService } from '../src/auth/password.service';

/**
 * Hashing is deliberately expensive — 64 MiB and two passes per call — so
 * these tests share a small number of hashes rather than creating one per
 * assertion.
 */
describe('PasswordService', () => {
  const passwords = new PasswordService();
  const PASSWORD = 'correct horse battery staple';

  let hash: string;

  beforeAll(async () => {
    hash = await passwords.hash(PASSWORD);
  }, 30000);

  describe('encoding', () => {
    it('records the algorithm, version, and cost parameters in the hash', () => {
      // The parameters travel with the hash so they can be raised later
      // without invalidating what is already stored.
      expect(hash).toMatch(/^scrypt\$v=1\$n=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/]+={0,2}\$/);
    });

    it('stores neither the password nor anything derived from it in plain text', () => {
      expect(hash).not.toContain(PASSWORD);
      expect(hash.toLowerCase()).not.toContain('horse');
    });

    it('produces a different hash each time for the same password', async () => {
      // A repeated hash would mean an unsalted digest: identical passwords
      // across accounts would be visible as identical rows.
      const again = await passwords.hash(PASSWORD);

      expect(again).not.toBe(hash);
      await expect(passwords.verify(PASSWORD, again)).resolves.toBe(true);
    }, 30000);
  });

  describe('verify', () => {
    it('accepts the correct password', async () => {
      await expect(passwords.verify(PASSWORD, hash)).resolves.toBe(true);
    }, 30000);

    it('rejects a wrong password', async () => {
      await expect(passwords.verify('wrong horse battery staple', hash)).resolves.toBe(false);
    }, 30000);

    it('rejects a password differing only in case', async () => {
      await expect(passwords.verify(PASSWORD.toUpperCase(), hash)).resolves.toBe(false);
    }, 30000);

    it('rejects an empty password', async () => {
      await expect(passwords.verify('', hash)).resolves.toBe(false);
    }, 30000);

    it.each([
      ['empty', ''],
      ['not the encoding at all', 'not-a-hash'],
      ['too few fields', 'scrypt$v=1$n=16384,r=8,p=1$c2FsdA=='],
      ['too many fields', `${'scrypt$v=1$n=16384,r=8,p=1$c2FsdA==$aGFzaA=='}$extra`],
      ['unknown algorithm', 'bcrypt$v=1$n=16384,r=8,p=1$c2FsdA==$aGFzaA=='],
      ['unknown encoding version', 'scrypt$v=2$n=16384,r=8,p=1$c2FsdA==$aGFzaA=='],
      ['malformed parameters', 'scrypt$v=1$n=abc,r=8,p=1$c2FsdA==$aGFzaA=='],
      ['non-power-of-two cost', 'scrypt$v=1$n=16385,r=8,p=1$c2FsdA==$aGFzaA=='],
      ['empty salt', 'scrypt$v=1$n=16384,r=8,p=1$$aGFzaA=='],
      ['non-base64 salt', 'scrypt$v=1$n=16384,r=8,p=1$not valid!$aGFzaA=='],
    ])(
      'rejects a malformed stored hash (%s) without throwing',
      async (_label, stored) => {
        // A corrupted row is a failed login, not a 500 that tells the caller
        // something about the stored data.
        await expect(passwords.verify(PASSWORD, stored)).resolves.toBe(false);
      },
      30000,
    );

    it('rejects a hash whose digest has been tampered with', async () => {
      const parts = hash.split('$');
      const digest = Buffer.from(parts[4] ?? '', 'base64');
      digest[0] = (digest[0] ?? 0) ^ 0xff;
      parts[4] = digest.toString('base64');

      await expect(passwords.verify(PASSWORD, parts.join('$'))).resolves.toBe(false);
    }, 30000);

    it('rejects a hash whose salt has been swapped', async () => {
      const other = await passwords.hash(PASSWORD);
      const mine = hash.split('$');
      const theirs = other.split('$');
      // Their salt with my digest: neither half verifies against the other.
      mine[3] = theirs[3] ?? '';

      await expect(passwords.verify(PASSWORD, mine.join('$'))).resolves.toBe(false);
    }, 30000);

    it('refuses cost parameters above the configured maximum', async () => {
      // A hostile row must not be able to choose how much memory the process
      // allocates. n=2^30 at r=8 would be 1 TiB.
      const parts = hash.split('$');
      parts[2] = 'n=1073741824,r=8,p=2';

      await expect(passwords.verify(PASSWORD, parts.join('$'))).resolves.toBe(false);
    }, 30000);
  });

  describe('spendVerificationWork', () => {
    it('always reports failure', async () => {
      await expect(passwords.spendVerificationWork(PASSWORD)).resolves.toBe(false);
    }, 30000);
  });

  it('treats Unicode-equivalent passwords as the same password', async () => {
    // The same characters to the person typing them, composed as one code
    // point or as a base letter plus a combining mark. Which one arrives
    // depends on the platform and keyboard, not on the user.
    const composed = 'pässword-long-enough';
    const decomposed = 'pässword-long-enough';
    expect(composed).not.toBe(decomposed);

    const composedHash = await passwords.hash(composed);
    await expect(passwords.verify(decomposed, composedHash)).resolves.toBe(true);
  }, 30000);
});
