import { parseSignInResult, signIn } from '../src/api/auth';
import type { ApiClient, RequestOptions } from '../src/api/client';
import { ApiError } from '../src/api/errors';

const validBody = {
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

describe('parseSignInResult', () => {
  it('reads the documented response', () => {
    expect(parseSignInResult(validBody)).toEqual(validBody);
  });

  it('accepts a user with no memberships', () => {
    const body = { ...validBody, user: { ...validBody.user, memberships: [] } };
    expect(parseSignInResult(body).user.memberships).toEqual([]);
  });

  // TypeScript says nothing about what arrives over a network. Each of these
  // would otherwise surface as `undefined` somewhere far from the cause.
  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['an array', []],
    ['no access token', { ...validBody, accessToken: undefined }],
    ['an empty access token', { ...validBody, accessToken: '' }],
    ['no token type', { ...validBody, tokenType: undefined }],
    ['no user', { ...validBody, user: undefined }],
    ['no memberships', { ...validBody, user: { ...validBody.user, memberships: undefined } }],
    ['a missing user id', { ...validBody, user: { ...validBody.user, id: undefined } }],
  ])('rejects a response with %s', (_label, body) => {
    expect(() => parseSignInResult(body)).toThrow(ApiError);
  });

  it('rejects a token lifetime it cannot compute an expiry from', () => {
    expect(() => parseSignInResult({ ...validBody, expiresIn: 0 })).toThrow(ApiError);
    expect(() => parseSignInResult({ ...validBody, expiresIn: -1 })).toThrow(ApiError);
    expect(() => parseSignInResult({ ...validBody, expiresIn: '3600' })).toThrow(ApiError);
    expect(() => parseSignInResult({ ...validBody, expiresIn: Number.NaN })).toThrow(ApiError);
  });

  it('rejects a membership role the app does not know', () => {
    const body = {
      ...validBody,
      user: {
        ...validBody.user,
        memberships: [{ organizationId: 'org_1', role: 'SUPERUSER' }],
      },
    };
    expect(() => parseSignInResult(body)).toThrow(ApiError);
  });
});

describe('signIn', () => {
  it('posts the credentials to the login endpoint', async () => {
    const requests: RequestOptions[] = [];
    const client: ApiClient = {
      request: (options) => {
        requests.push(options);
        return Promise.resolve(validBody);
      },
    };

    const result = await signIn(client, { email: 'owner@example.com', password: 'secret' });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/auth/login',
        body: { email: 'owner@example.com', password: 'secret' },
      },
    ]);
    expect(result.accessToken).toBe('jwt-value');
  });

  it('sends no bearer token, because signing in is how one is obtained', async () => {
    let sent: RequestOptions | null = null;
    const client: ApiClient = {
      request: (options) => {
        sent = options;
        return Promise.resolve(validBody);
      },
    };

    await signIn(client, { email: 'owner@example.com', password: 'secret' });

    expect(sent!.token).toBeUndefined();
  });
});
