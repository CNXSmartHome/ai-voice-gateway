import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createApiClient } from '../api/client';
import { resolveApiConfig } from '../api/config';
import { readEnvironment } from '../api/environment';
import { createSessionController, INITIAL_SESSION_STATE } from './session';
import type { SessionController, SessionState } from './session';
import { secureStorage } from './secure-storage';
import { createTokenStore } from './token-store';

/**
 * Wires the session controller to React.
 *
 * Everything with a decision in it lives in `session.ts`; this holds the
 * result in state and hands it down. Keeping the split means the sign-in
 * rules are tested without a renderer, and this file stays small enough to
 * check by reading.
 */

interface SessionContextValue {
  readonly state: SessionState;
  readonly controller: SessionController;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  readonly children: ReactNode;
  /** Rendered instead of the app when the build has no usable API URL. */
  readonly renderConfigurationError: (message: string) => ReactNode;
}

export function SessionProvider({ children, renderConfigurationError }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>(INITIAL_SESSION_STATE);

  // Built once. A new client per render would also mean a new controller, and
  // the restore effect below would run on every render.
  const wiring = useMemo(() => {
    try {
      const client = createApiClient({ config: resolveApiConfig(readEnvironment()) });
      const tokenStore = createTokenStore(secureStorage);
      return { controller: createSessionController({ client, tokenStore }, setState), error: null };
    } catch (error) {
      // A missing API URL is a build mistake, not a user one. Showing it
      // plainly beats a sign-in screen that fails for reasons nobody can see.
      return { controller: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, []);

  const { controller } = wiring;

  useEffect(() => {
    if (controller === null) return;
    void controller.restore();
  }, [controller]);

  if (controller === null) {
    return <>{renderConfigurationError(wiring.error ?? 'The app is misconfigured.')}</>;
  }

  return (
    <SessionContext.Provider value={{ state, controller }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }
  return value;
}
