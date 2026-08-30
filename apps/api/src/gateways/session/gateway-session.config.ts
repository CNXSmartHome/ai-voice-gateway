/**
 * Transport configuration for the gateway session (VG-006).
 *
 * All non-secret: the path and the timing of liveness checks. The device
 * credential is not read here — it never leaves the database as plaintext.
 */
export interface GatewaySessionConfig {
  readonly path: string;
  /** How often the server pings an idle connection. */
  readonly heartbeatIntervalSeconds: number;
  /**
   * How long a connection may go without answering before it is dropped.
   *
   * Derived rather than configured separately, so the two cannot be set to a
   * contradictory pair -- a timeout shorter than the interval would kill
   * every healthy connection.
   */
  readonly heartbeatTimeoutSeconds: number;
}

export const DEFAULT_PATH = '/v1/gateway/session';
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;

/** Missed pings tolerated before a connection is considered dead. */
const MISSED_HEARTBEATS_ALLOWED = 2;

export function loadGatewaySessionConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewaySessionConfig {
  const heartbeatIntervalSeconds = parseInterval(env.GATEWAY_HEARTBEAT_INTERVAL_SECONDS);

  return {
    path: parsePath(env.GATEWAY_WS_PATH),
    heartbeatIntervalSeconds,
    heartbeatTimeoutSeconds: heartbeatIntervalSeconds * MISSED_HEARTBEATS_ALLOWED,
  };
}

function parsePath(value: string | undefined): string {
  const path = value?.trim();
  if (path === undefined || path === '') return DEFAULT_PATH;

  // A path that does not start with `/` would never match an upgrade request,
  // and the mismatch would look like a network fault rather than a typo.
  if (!path.startsWith('/')) {
    throw new Error(`GATEWAY_WS_PATH must start with "/", received: ${path}`);
  }
  return path;
}

function parseInterval(value: string | undefined): number {
  const raw = value?.trim();
  if (raw === undefined || raw === '') return DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error(
      `GATEWAY_HEARTBEAT_INTERVAL_SECONDS must be a positive integer, received: ${raw}`,
    );
  }
  return seconds;
}
