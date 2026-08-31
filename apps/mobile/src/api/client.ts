import type { ApiConfig } from './config';
import { ApiError, kindForStatus } from './errors';

/**
 * The API client.
 *
 * `fetch` and the clock are injected rather than reached for, so every branch
 * below -- including the timeout and a body that is not JSON -- is testable
 * without a server or a device.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly config: ApiConfig;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export interface RequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly body?: unknown;
  readonly token?: string;
}

export interface ApiClient {
  request(options: RequestOptions): Promise<unknown>;
}

/**
 * A phone loses its network mid-request often enough that this matters: with
 * no timeout, `fetch` on a dead connection can hang until the OS gives up,
 * and the user watches a spinner with no way to tell whether anything is
 * happening.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') {
    throw new TypeError('No fetch implementation is available.');
  }

  async function request(requestOptions: RequestOptions): Promise<unknown> {
    const { method, path, body, token } = requestOptions;
    const url = `${options.config.baseUrl}${path}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token !== undefined) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // A timeout and a lost connection are the same thing to the person
      // holding the phone: it did not go through, try again. The underlying
      // error is not carried forward -- it can contain the URL and, on some
      // platforms, request details that have no business in a log.
      throw new ApiError('network', 'Could not reach the server.');
    } finally {
      clearTimeout(timer);
    }

    // Read either way, so the body is consumed and the connection released
    // even on a failure whose contents are of no use.
    const text = await response.text().catch(() => '');

    if (!response.ok) {
      // Deliberately not parsed. The API says nothing useful in an error body
      // -- `docs/API.md` folds four distinct claim rejections into one 404 on
      // purpose -- and a proxy returning HTML on a 502 must not become a
      // parse crash on top of an outage.
      throw new ApiError(
        kindForStatus(response.status),
        `Request failed with status ${response.status}.`,
        response.status,
      );
    }

    // 204 has no body. Neither, effectively, does a success that is not JSON.
    if (text === '') return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  return { request };
}
