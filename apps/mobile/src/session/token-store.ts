import type { SignInResult } from '../api/auth';

/**
 * Where the access token lives.
 *
 * The storage is an interface rather than `expo-secure-store` directly, for
 * two reasons: the expiry and parsing rules below are the part worth testing,
 * and they cannot be tested against a native keychain. `secure-storage.ts`
 * supplies the real one.
 */

export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StoredSession {
  readonly accessToken: string;
  /** Milliseconds since the epoch, computed from the API's `expiresIn`. */
  readonly expiresAt: number;
  readonly userId: string;
  readonly email: string;
}

export interface TokenStore {
  /** The stored session, or null if there is none or it has expired. */
  read(): Promise<StoredSession | null>;
  save(result: SignInResult): Promise<StoredSession>;
  clear(): Promise<void>;
}

export const SESSION_KEY = 'vg.session';

/**
 * Treat a token as expired slightly early.
 *
 * A token with four seconds left will pass a check here and be rejected by
 * the API by the time the request lands, which shows up as an unexplained
 * sign-out mid-action. Better to sign in again a few seconds sooner.
 */
export const EXPIRY_SKEW_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a stored session back.
 *
 * Anything unrecognisable is treated as absent rather than as an error: the
 * value survives app upgrades, and a shape change between versions should
 * mean signing in again, not a device that cannot start.
 */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (raw === null || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const { accessToken, expiresAt, userId, email } = parsed;
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  if (typeof userId !== 'string' || userId === '') return null;
  if (typeof email !== 'string' || email === '') return null;

  return { accessToken, expiresAt, userId, email };
}

export function createTokenStore(storage: SecureStorage, now: () => number = Date.now): TokenStore {
  async function read(): Promise<StoredSession | null> {
    const session = parseStoredSession(await storage.getItem(SESSION_KEY));
    if (session === null) return null;

    if (session.expiresAt - EXPIRY_SKEW_MS <= now()) {
      // Removed rather than merely ignored. There is no refresh endpoint yet
      // (#17), so an expired token is dead weight that only ever leaks.
      await storage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  }

  async function save(result: SignInResult): Promise<StoredSession> {
    const session: StoredSession = {
      accessToken: result.accessToken,
      expiresAt: now() + result.expiresIn * 1000,
      userId: result.user.id,
      email: result.user.email,
    };
    await storage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async function clear(): Promise<void> {
    await storage.removeItem(SESSION_KEY);
  }

  return { read, save, clear };
}
