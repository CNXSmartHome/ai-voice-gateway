import { signIn as signInRequest, type Credentials, type SignInResult } from '../api/auth';
import type { ApiClient } from '../api/client';
import { isApiError } from '../api/errors';
import type { StoredSession, TokenStore } from './token-store';

/**
 * Sign-in as a state machine, separate from the screen that renders it.
 *
 * The screen is a form and a spinner. What is worth asserting -- that a
 * restore leaves you signed in, that a failure is reported without saying
 * which half of the credentials was wrong, that signing out actually removes
 * the token -- is here, and is tested without a renderer.
 */

export type SessionState =
  /** Reading storage at startup. Nothing has been decided yet. */
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out'; readonly error: string | null }
  | { readonly status: 'signing_in' }
  | { readonly status: 'signed_in'; readonly session: StoredSession };

export const INITIAL_SESSION_STATE: SessionState = { status: 'loading' };

/**
 * What to tell the user.
 *
 * VG-004 answers a wrong password and an unknown address identically, so that
 * the API cannot be used to discover which addresses have accounts. Saying
 * "no account with that email" here would undo that from the client side, so
 * `unauthorized` gets one message covering both.
 */
export function signInFailureMessage(error: unknown): string {
  if (!isApiError(error)) {
    return 'Something went wrong. Please try again.';
  }

  switch (error.kind) {
    case 'unauthorized':
      return 'That email and password do not match an account.';
    case 'network':
      return 'Could not reach the server. Check your connection and try again.';
    case 'invalid':
      return 'Enter your email address and password.';
    case 'server':
      return 'The server is having trouble. Please try again shortly.';
    case 'rejected':
    case 'unexpected':
      return 'Something went wrong. Please try again.';
  }
}

export interface SessionDependencies {
  readonly client: ApiClient;
  readonly tokenStore: TokenStore;
  /** Injected so the sign-in request itself can be faked in tests. */
  readonly signInRequest?: (client: ApiClient, credentials: Credentials) => Promise<SignInResult>;
}

export interface SessionController {
  /** Reads any stored session. Called once at startup. */
  restore(): Promise<SessionState>;
  signIn(credentials: Credentials): Promise<SessionState>;
  signOut(): Promise<SessionState>;
}

export function createSessionController(
  dependencies: SessionDependencies,
  onStateChange: (state: SessionState) => void = () => {},
): SessionController {
  const performSignIn = dependencies.signInRequest ?? signInRequest;

  function publish(state: SessionState): SessionState {
    onStateChange(state);
    return state;
  }

  async function restore(): Promise<SessionState> {
    try {
      const session = await dependencies.tokenStore.read();
      if (session === null) {
        return publish({ status: 'signed_out', error: null });
      }
      return publish({ status: 'signed_in', session });
    } catch {
      // Unreadable storage is not something the user can fix or needs to see;
      // it means signing in again, which is what a signed-out state asks for.
      return publish({ status: 'signed_out', error: null });
    }
  }

  async function signIn(credentials: Credentials): Promise<SessionState> {
    publish({ status: 'signing_in' });

    try {
      const result = await performSignIn(dependencies.client, credentials);
      const session = await dependencies.tokenStore.save(result);
      return publish({ status: 'signed_in', session });
    } catch (error) {
      return publish({ status: 'signed_out', error: signInFailureMessage(error) });
    }
  }

  async function signOut(): Promise<SessionState> {
    // Cleared before the state changes, so a failure here cannot leave a
    // signed-out screen with a live token still in the keychain.
    await dependencies.tokenStore.clear();
    return publish({ status: 'signed_out', error: null });
  }

  return { restore, signIn, signOut };
}
