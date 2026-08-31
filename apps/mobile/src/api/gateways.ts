import type { ApiClient } from './client';
import { ApiError } from './errors';

/**
 * Gateway claim, against the VG-005 endpoint.
 *
 * The full add-gateway flow is the second half of VG-008; this is the cloud
 * half of it, written now because it is what the sign-in session exists to
 * authorise and because it is testable without a device.
 */

export type GatewayStatus = 'UNCLAIMED' | 'ONLINE' | 'OFFLINE' | 'DISABLED';

export interface Gateway {
  readonly id: string;
  readonly serialNumber: string;
  readonly name: string;
  readonly status: GatewayStatus;
  readonly propertyId: string | null;
  readonly roomId: string | null;
  readonly firmwareVersion: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimGatewayRequest {
  readonly serialNumber: string;
  readonly propertyId: string;
  readonly roomId?: string;
  readonly name?: string;
}

const STATUSES: readonly GatewayStatus[] = ['UNCLAIMED', 'ONLINE', 'OFFLINE', 'DISABLED'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new ApiError('unexpected', `The server response is missing "${key}".`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ApiError('unexpected', `The server returned an unexpected "${key}".`);
  }
  return value;
}

export function parseGateway(body: unknown): Gateway {
  if (!isRecord(body)) {
    throw new ApiError('unexpected', 'The server returned an unexpected response.');
  }

  const status = body.status;
  if (typeof status !== 'string' || !STATUSES.includes(status as GatewayStatus)) {
    throw new ApiError('unexpected', 'The server returned an unknown gateway status.');
  }

  return {
    id: requireString(body, 'id'),
    serialNumber: requireString(body, 'serialNumber'),
    name: requireString(body, 'name'),
    status: status as GatewayStatus,
    propertyId: optionalString(body, 'propertyId'),
    roomId: optionalString(body, 'roomId'),
    firmwareVersion: optionalString(body, 'firmwareVersion'),
    lastSeenAt: optionalString(body, 'lastSeenAt'),
    createdAt: requireString(body, 'createdAt'),
    updatedAt: requireString(body, 'updatedAt'),
  };
}

/**
 * Claims a gateway.
 *
 * A rejection is a `rejected` error and nothing more specific, because the
 * API answers "no such serial", "already claimed", "not your property", and
 * "you lack the role" with the same `404` on purpose. The UI must not invent
 * a reason it was not told.
 */
export async function claimGateway(
  client: ApiClient,
  token: string,
  request: ClaimGatewayRequest,
): Promise<Gateway> {
  const body = await client.request({
    method: 'POST',
    path: '/v1/gateways/claim',
    token,
    body: {
      serialNumber: request.serialNumber,
      propertyId: request.propertyId,
      ...(request.roomId === undefined ? {} : { roomId: request.roomId }),
      ...(request.name === undefined ? {} : { name: request.name }),
    },
  });
  return parseGateway(body);
}
