/**
 * The wire protocol for the gateway session (VG-006).
 *
 * Deliberately small. This socket carries liveness and firmware reporting;
 * audio (VG-018) and AI tool traffic (VG-019, VG-021) are separate tasks and
 * will add their own message types rather than overloading these.
 */

/** Authentication scheme on the upgrade request. */
export const GATEWAY_AUTH_SCHEME = 'Gateway';

/** Messages a gateway may send. */
export type InboundMessage = { type: 'heartbeat'; firmwareVersion?: string };

/** Messages the server sends. */
export type OutboundMessage =
  | { type: 'ready'; gatewayId: string; roomId: string | null; heartbeatIntervalSeconds: number }
  | { type: 'heartbeat_ack'; serverTime: string };

/** Longest frame accepted, so a hostile client cannot exhaust memory. */
export const MAX_FRAME_BYTES = 4096;

export const MAX_FIRMWARE_VERSION_LENGTH = 64;

/**
 * Close codes. 4000-4999 is the application-defined range.
 *
 * Every authentication failure uses the same code and reason. An unknown
 * serial, a wrong secret, an unclaimed gateway, and a disabled one must be
 * indistinguishable, for the same reason VG-005's claim rejections are.
 */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_UNAUTHORIZED_REASON = 'unauthorized';
export const CLOSE_PROTOCOL_ERROR = 4400;
export const CLOSE_PROTOCOL_ERROR_REASON = 'protocol error';
/** The peer stopped answering liveness pings. */
export const CLOSE_TIMEOUT = 4408;
export const CLOSE_TIMEOUT_REASON = 'heartbeat timeout';

/** Credentials presented on the upgrade request. */
export interface PresentedCredentials {
  readonly serialNumber: string;
  readonly secret: string;
}

/**
 * Reads gateway credentials from an Authorization header.
 *
 * Uses its own scheme rather than `Bearer`, so a device credential and a user
 * access token can never be presented interchangeably: a user's JWT does not
 * parse here, and this value is meaningless to the HTTP guard.
 *
 * Format: `Gateway <serialNumber>:<secret>`. The serial cannot contain a
 * colon (VG-005 constrains it to letters, digits, and hyphens), so the first
 * colon is an unambiguous separator and the secret may contain any of them.
 */
export function parseAuthorization(header: unknown): PresentedCredentials | null {
  if (typeof header !== 'string') return null;

  const prefix = `${GATEWAY_AUTH_SCHEME} `;
  if (header.length <= prefix.length) return null;
  if (header.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;

  const value = header.slice(prefix.length);
  const separator = value.indexOf(':');
  if (separator <= 0) return null;

  const serialNumber = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (serialNumber === '' || secret === '') return null;

  return { serialNumber, secret };
}

/**
 * Parses a frame from a gateway.
 *
 * Returns null for anything unrecognised. The caller closes the connection
 * rather than ignoring the frame: this is a device protocol with one
 * implementation on each end, so an unparseable message means the two are out
 * of step, and carrying on would hide that.
 */
export function parseInboundMessage(raw: unknown): InboundMessage | null {
  if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) return null;

  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const message = parsed as Record<string, unknown>;
  if (message.type !== 'heartbeat') return null;

  const firmwareVersion = message.firmwareVersion;
  if (firmwareVersion === undefined || firmwareVersion === null) {
    return { type: 'heartbeat' };
  }

  if (
    typeof firmwareVersion !== 'string' ||
    firmwareVersion.length === 0 ||
    firmwareVersion.length > MAX_FIRMWARE_VERSION_LENGTH
  ) {
    return null;
  }

  return { type: 'heartbeat', firmwareVersion };
}

export function serializeOutbound(message: OutboundMessage): string {
  return JSON.stringify(message);
}
