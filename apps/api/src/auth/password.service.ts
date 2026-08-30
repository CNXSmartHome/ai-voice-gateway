import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * Promise wrapper around `scrypt`.
 *
 * Written out rather than `promisify`d so the four-argument overload — the
 * one that takes cost parameters — is the one being called. `promisify`
 * resolves to the three-argument form, which silently uses Node's defaults.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * scrypt cost parameters.
 *
 * `n = 2^16` with `r = 8` costs 64 MiB of memory per hash, which is the
 * configuration OWASP lists for scrypt. Memory is what makes the hash
 * expensive to attack in parallel on a GPU, so it is the parameter that
 * matters most; `p` buys CPU time on top of that.
 *
 * Node's default `maxmem` is 32 MiB, which these parameters exceed, so it is
 * raised explicitly below. Without that, hashing fails at runtime rather
 * than quietly using weaker settings.
 */
const PARAMETERS = { n: 65536, r: 8, p: 2 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** 128 * n * r is scrypt's working set; double it for headroom. */
const MAX_MEMORY = 256 * PARAMETERS.n * PARAMETERS.r;

const ALGORITHM = 'scrypt';
const ENCODING_VERSION = 1;

/**
 * Hashes and verifies user passwords.
 *
 * Hashes are stored in a self-describing format:
 *
 *     scrypt$v=1$n=65536,r=8,p=2$<salt base64>$<hash base64>
 *
 * The parameters travel with the hash rather than living only in this file,
 * so raising the cost later — or moving to a different algorithm — does not
 * invalidate every stored password. Existing hashes keep verifying against
 * the parameters they were created with.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await derive(password, salt, PARAMETERS);

    const { n, r, p } = PARAMETERS;
    return [
      ALGORITHM,
      `v=${String(ENCODING_VERSION)}`,
      `n=${String(n)},r=${String(r)},p=${String(p)}`,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  /**
   * Verifies a password against a stored hash.
   *
   * Returns false rather than throwing on a malformed hash: a corrupted or
   * truncated row is a failed login, not a 500 that tells the caller
   * something about the stored data.
   */
  async verify(password: string, storedHash: string): Promise<boolean> {
    const parsed = parse(storedHash);
    if (parsed === null) return false;

    const derived = await derive(password, parsed.salt, parsed.parameters, parsed.hash.length);

    // Lengths must match before timingSafeEqual, which throws otherwise.
    if (derived.length !== parsed.hash.length) return false;
    return timingSafeEqual(derived, parsed.hash);
  }

  /**
   * Spends the same work as a real verification and always fails.
   *
   * Login calls this when no user matches, so that a request for an unknown
   * address costs what a request for a known one costs. Without it, response
   * time alone reveals which addresses have accounts.
   */
  async spendVerificationWork(password: string): Promise<false> {
    await derive(password, randomBytes(SALT_LENGTH), PARAMETERS);
    return false;
  }
}

interface ScryptParameters {
  readonly n: number;
  readonly r: number;
  readonly p: number;
}

async function derive(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
  keyLength: number = KEY_LENGTH,
): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, keyLength, {
    ...parameters,
    maxmem: MAX_MEMORY,
  });
}

interface ParsedHash {
  readonly parameters: ScryptParameters;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

/** Strict parse of the stored encoding. Anything unexpected yields null. */
function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 5) return null;

  const [algorithm, version, rawParameters, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== ALGORITHM) return null;
  if (version !== `v=${String(ENCODING_VERSION)}`) return null;

  const parameters = parseParameters(rawParameters);
  if (parameters === null) return null;

  const salt = decodeBase64(rawSalt);
  const hash = decodeBase64(rawHash);
  if (salt === null || hash === null || salt.length === 0 || hash.length === 0) return null;

  return { parameters, salt, hash };
}

function parseParameters(raw: string): ScryptParameters | null {
  const match = /^n=(\d+),r=(\d+),p=(\d+)$/.exec(raw);
  if (!match) return null;

  const [n, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];

  // Guard the values before handing them to scrypt: a hostile row could
  // otherwise ask for an allocation large enough to take the process down.
  if (n < 2 || r < 1 || p < 1) return null;
  if (n > PARAMETERS.n || r > PARAMETERS.r || p > PARAMETERS.p) return null;
  if ((n & (n - 1)) !== 0) return null; // scrypt requires a power of two

  return { n, r, p };
}

/**
 * Decodes base64, rejecting input Node would silently accept by discarding
 * invalid characters — a tampered hash must fail the parse, not round-trip
 * into something shorter.
 */
function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;

  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}
