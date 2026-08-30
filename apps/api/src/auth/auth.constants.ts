/** Injection token for the resolved {@link AuthConfig}. */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/** Metadata key marking a route as reachable without authentication. */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Where {@link JwtAuthGuard} stores the authenticated user on the request. */
export const REQUEST_USER_KEY = 'authenticatedUser';
