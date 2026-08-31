import type { SignInResult } from '../src/api/auth';
import type { ApiClient } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import { createSessionController, signInFailureMessage } from '../src/session/session';
import type { SessionState } from '../src/session/session';
import { createTokenStore, type SecureStorage } from '../src/session/token-store';

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

const unusedClient: ApiClient = {
  request: () => Promise.reject(new Error('the client should not have been called')),
};

function fakeStorage() {
  const values = new Map<string, string>();
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

function setup(signIn: () => Promise<SignInResult>) {
  const { storage, values } = fakeStorage();
  const states: SessionState[] = [];
  const controller = createSessionController(
    {
      client: unusedClient,
      tokenStore: createTokenStore(storage, () => 1_000_000),
      signInRequest: signIn,
    },
    (state) => states.push(state),
  );
  return { controller, states, values };
}

describe('signInFailureMessage', () => {
  /*
   * VG-004 answers a wrong password and an unknown address identically, so
   * the API cannot be used to discover which addresses have accounts. A
   * friendlier message here -- "no account with that email" -- would give
   * that away from the client instead.
   */
  it('does not say which half of the credentials was wrong', () => {
    const message = signInFailureMessage(new ApiError('unauthorized', 'x', 401));

    expect(message).not.toMatch(/password is|no account|unknown|not found|incorrect password/i);
    expect(message).toBe('That email and password do not match an account.');
  });

  it('distinguishes the failures a user can act on', () => {
    const network = signInFailureMessage(new ApiError('network', 'x'));
    const server = signInFailureMessage(new ApiError('server', 'x', 500));

    expect(network).toMatch(/connection/i);
    expect(server).not.toBe(network);
  });

  it('falls back to something safe for anything it was not written for', () => {
    expect(signInFailureMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    expect(signInFailureMessage('boom')).toBe('Something went wrong. Please try again.');
    expect(signInFailureMessage(new ApiError('unexpected', 'x', 418))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('never repeats the message from the server, which is not written for a user', () => {
    const message = signInFailureMessage(
      new ApiError('unauthorized', 'Request failed with status 401.', 401),
    );
    expect(message).not.toContain('401');
  });
});

describe('createSessionController', () => {
  it('signs in, stores the session, and reports it', async () => {
    const { controller, states, values } = setup(() => Promise.resolve(signInResult));

    const finalState = await controller.signIn({
      email: 'owner@example.com',
      password: 'secret',
    });

    expect(states.map((state) => state.status)).toEqual(['signing_in', 'signed_in']);
    expect(finalState).toEqual({
      status: 'signed_in',
      session: {
        accessToken: 'jwt-value',
        expiresAt: 1_000_000 + 3_600_000,
        userId: 'user_1',
        email: 'owner@example.com',
      },
    });
    expect(values.size).toBe(1);
  });

  it('reports a failure without storing anything', async () => {
    const { controller, states, values } = setup(() =>
      Promise.reject(new ApiError('unauthorized', 'x', 401)),
    );

    const finalState = await controller.signIn({ email: 'owner@example.com', password: 'wrong' });

    expect(states.map((state) => state.status)).toEqual(['signing_in', 'signed_out']);
    expect(finalState).toEqual({
      status: 'signed_out',
      error: 'That email and password do not match an account.',
    });
    expect(values.size).toBe(0);
  });

  it('restores a stored session on startup', async () => {
    const { controller } = setup(() => Promise.resolve(signInResult));
    await controller.signIn({ email: 'owner@example.com', password: 'secret' });

    await expect(controller.restore()).resolves.toMatchObject({ status: 'signed_in' });
  });

  it('starts signed out when there is nothing stored', async () => {
    const { controller } = setup(() => Promise.resolve(signInResult));

    await expect(controller.restore()).resolves.toEqual({ status: 'signed_out', error: null });
  });

  // Storage that cannot be read is not something the user can fix and not
  // something worth an error message; it means signing in again.
  it('starts signed out when storage cannot be read', async () => {
    const controller = createSessionController({
      client: unusedClient,
      tokenStore: {
        read: () => Promise.reject(new Error('keychain unavailable')),
        save: () => Promise.reject(new Error('unused')),
        clear: () => Promise.resolve(),
      },
      signInRequest: () => Promise.resolve(signInResult),
    });

    await expect(controller.restore()).resolves.toEqual({ status: 'signed_out', error: null });
  });

  it('removes the stored token on sign-out', async () => {
    const { controller, values } = setup(() => Promise.resolve(signInResult));
    await controller.signIn({ email: 'owner@example.com', password: 'secret' });

    const finalState = await controller.signOut();

    expect(finalState).toEqual({ status: 'signed_out', error: null });
    expect(values.size).toBe(0);
    await expect(controller.restore()).resolves.toEqual({ status: 'signed_out', error: null });
  });

  // Ordering matters: a signed-out screen with a live token still in the
  // keychain is worse than a sign-out that visibly fails.
  it('does not report a sign-out that failed to clear the token', async () => {
    const controller = createSessionController({
      client: unusedClient,
      tokenStore: {
        read: () => Promise.resolve(null),
        save: () => Promise.reject(new Error('unused')),
        clear: () => Promise.reject(new Error('keychain unavailable')),
      },
      signInRequest: () => Promise.resolve(signInResult),
    });

    await expect(controller.signOut()).rejects.toThrow('keychain unavailable');
  });
});
