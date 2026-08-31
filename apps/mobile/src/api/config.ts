/**
 * Where the API lives.
 *
 * `EXPO_PUBLIC_*` values are substituted into the bundle at build time, which
 * makes them readable by anyone with the app. That is fine for a base URL and
 * unacceptable for anything else, so this is the only variable the app reads:
 * no key, token, or credential is ever shipped this way.
 */

export interface ApiConfig {
  /** Absolute origin with no trailing slash, e.g. `https://api.example.com`. */
  readonly baseUrl: string;
}

export class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigError';
  }
}

export const API_URL_VARIABLE = 'EXPO_PUBLIC_API_URL';

/**
 * Reads and validates the API base URL.
 *
 * Validated at startup rather than at the first request: a bundle built
 * without the variable would otherwise ship, install, and fail at the sign-in
 * screen with a message about a malformed URL, which tells whoever built it
 * nothing about what they forgot.
 */
export function resolveApiConfig(environment: Record<string, string | undefined>): ApiConfig {
  const value = environment[API_URL_VARIABLE];

  if (value === undefined || value.trim() === '') {
    throw new ApiConfigError(
      `${API_URL_VARIABLE} is not set. Copy .env.example to .env and point it at the API.`,
    );
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiConfigError(`${API_URL_VARIABLE} is not a valid URL: ${value}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiConfigError(`${API_URL_VARIABLE} must be http or https, not ${url.protocol}`);
  }

  if (url.search !== '' || url.hash !== '') {
    throw new ApiConfigError(`${API_URL_VARIABLE} must be an origin and path only: ${value}`);
  }

  // `new URL('https://host')` normalises to a trailing slash. Paths are joined
  // with a leading slash, so it is removed here rather than guessed at later.
  const normalised = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  return { baseUrl: normalised };
}
