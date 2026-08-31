import type { SignInResult } from '../src/api/auth';
import {
  createTokenStore,
  EXPIRY_SKEW_MS,
  parseStoredSession,
  SESSION_KEY,
  type SecureStorage,
} from '../src/session/token-store';

const signInResult: SignInResult = {
  accessToken: 'jwt-value',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: {
    id: 'user_1',
    email: 'owner@example.com',
    name: 'Owner',
    memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
  },
};

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: SecureStorage = {
    getItem: (key) => Promise.resolve(values.get(key) ?? null),
    setItem: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
  return { storage, values };
}

describe('parseStoredSession', () => {
  it('reads a session it wrote', () => {
    const raw = JSON.stringify({
      accessToken: 'jwt',
      expiresAt: 1_000,
      userId: 'user_1',
      email: 'owner@example.com',
    });
    expect(parseStoredSession(raw)).toEqual({
      accessToken: 'jwt',
      expiresAt: 1_000,
      userId: 'user_1',
      email: 'owner@example.com',
    });
  });

  /*
   * Anything unreadable means signing in again, not a crash. This value
   * survives app upgrades, so a shape change between versions is a case that
   * will actually happen.
   */
  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['not JSON', 'not json'],
    ['a JSON array', '[]'],
    ['a missing token', '{"expiresAt":1,"userId":"u","email":"e"}'],
    ['an empty token', '{"accessToken":"","expiresAt":1,"userId":"u","email":"e"}'],
    ['a string expiry', '{"accessToken":"j","expiresAt":"1","userId":"u","email":"e"}'],
    ['a missing user id', '{"accessToken":"j","expiresAt":1,"email":"e"}'],
  ])('treats %s as no session', (_label, raw) => {
    expect(parseStoredSession(raw)).toBeNull();
  });
});

describe('createTokenStore', () => {
  it('stores a session under one key and reads it back', async () => {
    const { storage, values } = fakeStorage();
    const store = createTokenStore(storage, () => 1_000_000);

    const saved = await store.save(signInResult);

    expect(saved).toEqual({
      accessToken: 'jwt-value',
      expiresAt: 1_000_000 + 3_600_000,
      userId: 'user_1',
      email: 'owner@example.com',
    });
    expect([...values.keys()]).toEqual([SESSION_KEY]);
    await expect(store.read()).resolves.toEqual(saved);
  });

  it('stores no password and no name', async () => {
    const { storage, values } = fakeStorage();
    await createTokenStore(storage, () => 0).save(signInResult);

    const stored = values.get(SESSION_KEY) ?? '';
    expect(stored).not.toContain('Owner');
    expect(stored).not.toContain('password');
  });

  it('returns nothing when there is nothing stored', async () => {
    const { storage } = fakeStorage();
    await expect(createTokenStore(storage).read()).resolves.toBeNull();
  });

  it('discards an expired session instead of returning it', async () => {
    let now = 1_000_000;
    const { storage, values } = fakeStorage();
    const store = createTokenStore(storage, () => now);

    await store.save(signInResult);
    now += 3_600_001;

    await expect(store.read()).resolves.toBeNull();
    // Removed, not merely ignored: with no refresh endpoint (#17) an expired
    // token can only ever leak.
    expect(values.has(SESSION_KEY)).toBe(false);
  });

  /*
   * A token with seconds left passes a naive check here and is refused by the
   * API by the time the request lands, which looks to the user like being
   * signed out mid-action for no reason.
   */
  it('treats a session about to expire as already expired', async () => {
    let now = 1_000_000;
    const { storage } = fakeStorage();
    const store = createTokenStore(storage, () => now);

    await store.save(signInResult);
    now += 3_600_000 - EXPIRY_SKEW_MS + 1;

    await expect(store.read()).resolves.toBeNull();
  });

  it('keeps a session that is still comfortably valid', async () => {
    let now = 1_000_000;
    const { storage } = fakeStorage();
    const store = createTokenStore(storage, () => now);

    await store.save(signInResult);
    now += 3_600_000 - EXPIRY_SKEW_MS - 1;

    await expect(store.read()).resolves.not.toBeNull();
  });

  it('removes the session on clear', async () => {
    const { storage, values } = fakeStorage();
    const store = createTokenStore(storage, () => 0);

    await store.save(signInResult);
    await store.clear();

    expect(values.has(SESSION_KEY)).toBe(false);
    await expect(store.read()).resolves.toBeNull();
  });
});
