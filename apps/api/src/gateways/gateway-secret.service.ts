import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/** Bytes of entropy in a device secret. */
const SECRET_BYTES = 32;

const ALGORITHM = 'sha256';
const ENCODING_VERSION = 1;

/**
 * Generates and verifies the secret a gateway authenticates with.
 *
 * Stored as `sha256$v=1$<hash base64>` — a plain digest, deliberately, not
 * the memory-hard KDF `PasswordService` uses.
 *
 * The two cases are not alike. A password is chosen by a person, is low
 * entropy, and is often reused, so a stolen hash must be expensive to attack
 * offline; that is what 64 MiB of scrypt buys. A device secret is 256 bits
 * from a CSPRNG. There is no dictionary, no reuse, and no feasible brute
 * force — a KDF would add nothing an attacker has to defeat.
 *
 * It would add a cost to us: verification runs on every connection and
 * reconnect, so a memory-hard hash on this path is a denial-of-service
 * surface. A fleet reconnecting after a network blip would each demand 64 MiB.
 *
 * There is no salt for the same reason. Salts defeat precomputation across
 * shared or guessable inputs; nothing can be precomputed against a random
 * 256-bit value. Comparison is still timing-safe.
 */
@Injectable()
export class GatewaySecretService {
  /**
   * Returns a new secret and the hash to store.
   *
   * The plaintext is returned once, to the caller that will flash it to the
   * device. Nothing persists it, so it cannot be recovered later — a gateway
   * that loses its secret needs a new credential, not a lookup.
   */
  generate(): { secret: string; secretHash: string } {
    const secret = randomBytes(SECRET_BYTES).toString('base64url');

    return { secret, secretHash: this.hash(secret) };
  }

  hash(secret: string): string {
    const digest = createHash(ALGORITHM).update(secret, 'utf8').digest('base64');

    return `${ALGORITHM}$v=${String(ENCODING_VERSION)}$${digest}`;
  }

  /**
   * Verifies a presented secret against a stored hash.
   *
   * Returns false rather than throwing on a malformed stored value: a
   * corrupted row is a failed authentication, not a crash that tells the
   * caller something about the stored data.
   */
  verify(secret: string, storedHash: string): boolean {
    if (typeof secret !== 'string' || secret === '') return false;
    if (!isWellFormed(storedHash)) return false;

    const expected = Buffer.from(storedHash, 'utf8');
    const actual = Buffer.from(this.hash(secret), 'utf8');

    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}

/** Strict shape check, so a truncated or tampered row fails the parse. */
function isWellFormed(storedHash: string): boolean {
  if (typeof storedHash !== 'string') return false;

  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  if (parts[0] !== ALGORITHM) return false;
  if (parts[1] !== `v=${String(ENCODING_VERSION)}`) return false;

  const digest = parts[2] ?? '';
  return /^[A-Za-z0-9+/]+={0,2}$/.test(digest) && digest.length > 0;
}
