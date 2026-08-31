/**
 * What went wrong, in the only categories the app can act on differently.
 *
 * These are deliberately coarser than HTTP status codes, because the API is
 * deliberately coarse: `docs/API.md` folds "unknown serial", "already
 * claimed", "not your property", and "you lack the role" into one `404` so
 * that nobody can enumerate them. Modelling those separately here would
 * invent a distinction the server refuses to make.
 */
export type ApiErrorKind =
  /** The request never reached an answer: offline, DNS, timeout. */
  | 'network'
  /** 401. Absent, expired, or wrong credentials -- which, is not said. */
  | 'unauthorized'
  /** 404. The server declined and will not say why. */
  | 'rejected'
  /** 400. The request was malformed. A client bug or empty input. */
  | 'invalid'
  /** 5xx. The server failed. Retrying may work. */
  | 'server'
  /** A status or body this client was not written for. */
  | 'unexpected';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Maps a status code to a kind.
 *
 * Anything unlisted is `unexpected` rather than guessed at. A client that
 * quietly treats an unknown status as a familiar one hides the day the
 * contract changed.
 */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'rejected';
  if (status >= 500) return 'server';
  return 'unexpected';
}
