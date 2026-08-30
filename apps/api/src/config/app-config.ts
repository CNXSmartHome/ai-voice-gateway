/**
 * Runtime configuration resolved from the environment.
 *
 * Only non-secret values are read here. Datastore and provider credentials
 * arrive in later tasks (VG-003, VG-004, VG-010) and must come from the
 * platform secret store, never from committed files.
 */
export interface AppConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly apiPrefix: string;
}

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '0.0.0.0';
export const API_PREFIX = 'v1';

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.API_HOST ?? DEFAULT_HOST,
    port: parsePort(env.API_PORT),
    apiPrefix: API_PREFIX,
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be an integer between 1 and 65535, received: ${value}`);
  }
  return port;
}
