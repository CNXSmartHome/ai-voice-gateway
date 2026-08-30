import { randomBytes } from 'node:crypto';

/**
 * Authentication configuration resolved from the environment.
 *
 * The signing secret is read here and nowhere else. It has no committed
 * default: see AI_GOVERNANCE.md, which requires secret values to live in
 * GitHub Actions Secrets or a cloud secret manager.
 */
export interface AuthConfig {
  readonly secret: string;
  readonly issuer: string;
  readonly accessTtlSeconds: number;
}

export const DEFAULT_ISSUER = 'ai-voice-gateway';
export const DEFAULT_ACCESS_TTL_SECONDS = 3600;

/**
 * Minimum secret length outside development.
 *
 * HS256 keys shorter than the 256-bit hash gain nothing from the extra hash
 * width, so 32 characters is the floor worth enforcing.
 */
export const MINIMUM_SECRET_LENGTH = 32;

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';

  return {
    secret: resolveSecret(env.JWT_SECRET, nodeEnv),
    issuer: nonEmpty(env.JWT_ISSUER) ?? DEFAULT_ISSUER,
    accessTtlSeconds: parseTtl(env.JWT_ACCESS_TTL_SECONDS),
  };
}

/**
 * Resolves the signing secret, failing closed in production.
 *
 * Outside production a missing secret becomes a random one generated at
 * startup, so a developer can run the API without configuring anything. That
 * secret does not survive a restart, which is the point: it cannot be
 * mistaken for a real one, cannot be committed, and every existing token
 * stops verifying when the process ends. In production the same situation is
 * a startup failure instead — a generated secret there would silently
 * invalidate every session on each deploy and differ per instance.
 */
function resolveSecret(raw: string | undefined, nodeEnv: string): string {
  const secret = nonEmpty(raw);

  if (nodeEnv === 'production') {
    if (secret === undefined) {
      throw new Error('JWT_SECRET is required in production; refusing to start without it.');
    }
    if (secret.length < MINIMUM_SECRET_LENGTH) {
      // Deliberately reports the requirement, never the value or its prefix.
      throw new Error(
        `JWT_SECRET must be at least ${String(MINIMUM_SECRET_LENGTH)} characters in production, received ${String(secret.length)}.`,
      );
    }
    return secret;
  }

  return secret ?? randomBytes(32).toString('base64');
}

function parseTtl(value: string | undefined): number {
  if (nonEmpty(value) === undefined) return DEFAULT_ACCESS_TTL_SECONDS;

  const ttl = Number(value);
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error(
      `JWT_ACCESS_TTL_SECONDS must be a positive integer, received: ${String(value)}`,
    );
  }
  return ttl;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
