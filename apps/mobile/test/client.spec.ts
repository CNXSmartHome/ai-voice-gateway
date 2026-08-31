import { createApiClient, type FetchLike } from '../src/api/client';
import { ApiError } from '../src/api/errors';

const config = { baseUrl: 'https://api.example.com' };

function respondWith(status: number, body: string, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('createApiClient', () => {
  it('builds the URL, headers, and body of a request', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(respondWith(200, '{"ok":true}'));
    };

    const client = createApiClient({ config, fetchImpl });
    const result = await client.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { email: 'a@example.com' },
      token: 'token-123',
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/v1/auth/login');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe('{"email":"a@example.com"}');
    expect(calls[0].init?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-123',
    });
  });

  it('sends no content type or authorization when there is nothing to send', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return Promise.resolve(respondWith(200, '{}'));
    };

    await createApiClient({ config, fetchImpl }).request({ method: 'GET', path: '/v1/auth/me' });

    expect(headers).toEqual({ Accept: 'application/json' });
  });

  it.each([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [404, 'rejected'],
    [500, 'server'],
    [503, 'server'],
    [418, 'unexpected'],
  ])('maps %i to %s', async (status, kind) => {
    const fetchImpl: FetchLike = () => Promise.resolve(respondWith(status, '{}'));
    const client = createApiClient({ config, fetchImpl });

    await expect(client.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
      kind,
      status,
    });
  });

  it('reports a failed fetch as a network error, without the underlying detail', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.local'));
    const client = createApiClient({ config, fetchImpl });

    const error = await client
      .request({ method: 'GET', path: '/v1/x' })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('network');
    expect((error as ApiError).message).not.toContain('ENOTFOUND');
  });

  it('aborts a request that outlives the timeout', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const client = createApiClient({ config, fetchImpl, timeoutMs: 10 });

    await expect(client.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
      kind: 'network',
    });
  });

  // A proxy returning an HTML error page is common enough that a parse crash
  // here would be a real bug, not a theoretical one.
  it('treats an unparseable success body as no body rather than crashing', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(respondWith(200, '<html>nope</html>'));
    const client = createApiClient({ config, fetchImpl });

    await expect(client.request({ method: 'GET', path: '/v1/x' })).resolves.toBeUndefined();
  });

  it('accepts an empty success body', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(respondWith(204, ''));
    const client = createApiClient({ config, fetchImpl });

    await expect(client.request({ method: 'GET', path: '/v1/x' })).resolves.toBeUndefined();
  });

  it('prefers the status over an error body it cannot read', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(respondWith(502, '<html>bad gateway</html>'));
    const client = createApiClient({ config, fetchImpl });

    await expect(client.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
      kind: 'server',
      status: 502,
    });
  });
});
