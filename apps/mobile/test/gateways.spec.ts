import type { ApiClient, RequestOptions } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import { claimGateway, parseGateway } from '../src/api/gateways';

const claimed = {
  id: 'gw_1',
  serialNumber: 'VG100-0001',
  name: 'Hall gateway',
  status: 'OFFLINE',
  propertyId: 'prop_1',
  roomId: 'room_1',
  firmwareVersion: null,
  lastSeenAt: null,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
};

describe('parseGateway', () => {
  it('reads the documented claim response', () => {
    expect(parseGateway(claimed)).toEqual(claimed);
  });

  it('keeps the nullable fields nullable', () => {
    const unclaimed = {
      ...claimed,
      status: 'UNCLAIMED',
      propertyId: null,
      roomId: null,
    };
    expect(parseGateway(unclaimed).propertyId).toBeNull();
  });

  it('rejects a status the app has no behaviour for', () => {
    expect(() => parseGateway({ ...claimed, status: 'PENDING' })).toThrow(ApiError);
  });

  it.each([
    ['no id', { ...claimed, id: undefined }],
    ['no serial number', { ...claimed, serialNumber: undefined }],
    ['a numeric room id', { ...claimed, roomId: 7 }],
    ['not an object', 'nope'],
  ])('rejects a response with %s', (_label, body) => {
    expect(() => parseGateway(body)).toThrow(ApiError);
  });
});

describe('claimGateway', () => {
  it('sends the serial, the property, and the bearer token', async () => {
    const requests: RequestOptions[] = [];
    const client: ApiClient = {
      request: (options) => {
        requests.push(options);
        return Promise.resolve(claimed);
      },
    };

    await claimGateway(client, 'token-123', {
      serialNumber: 'VG100-0001',
      propertyId: 'prop_1',
    });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/v1/gateways/claim',
        token: 'token-123',
        body: { serialNumber: 'VG100-0001', propertyId: 'prop_1' },
      },
    ]);
  });

  // `docs/API.md` documents these as optional and the gateway keeps the name
  // it was registered with when one is absent. Sending an explicit undefined
  // would defeat that.
  it('omits the optional fields rather than sending them empty', async () => {
    let sent: RequestOptions | null = null;
    const client: ApiClient = {
      request: (options) => {
        sent = options;
        return Promise.resolve(claimed);
      },
    };

    await claimGateway(client, 'token', { serialNumber: 'VG100-0001', propertyId: 'prop_1' });
    expect(Object.keys(sent!.body as object)).toEqual(['serialNumber', 'propertyId']);

    await claimGateway(client, 'token', {
      serialNumber: 'VG100-0001',
      propertyId: 'prop_1',
      roomId: 'room_1',
      name: 'Hall',
    });
    expect(sent!.body).toEqual({
      serialNumber: 'VG100-0001',
      propertyId: 'prop_1',
      roomId: 'room_1',
      name: 'Hall',
    });
  });

  /*
   * The API answers "no such serial", "already claimed", "not your property",
   * and "you lack the role" with the same 404, so that none of them can be
   * enumerated. The client must pass that through unelaborated.
   */
  it('passes a rejection through without inventing a reason', async () => {
    const client: ApiClient = {
      request: () =>
        Promise.reject(new ApiError('rejected', 'Request failed with status 404.', 404)),
    };

    const error = await claimGateway(client, 'token', {
      serialNumber: 'VG100-0001',
      propertyId: 'prop_1',
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('rejected');
  });
});
