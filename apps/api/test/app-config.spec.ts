import { API_PREFIX, DEFAULT_HOST, DEFAULT_PORT, loadAppConfig } from '../src/config/app-config';

describe('loadAppConfig', () => {
  it('falls back to safe defaults when nothing is set', () => {
    const config = loadAppConfig({});

    expect(config).toEqual({
      nodeEnv: 'development',
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      apiPrefix: API_PREFIX,
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadAppConfig({ NODE_ENV: 'staging', API_HOST: '127.0.0.1', API_PORT: '8080' });

    expect(config.nodeEnv).toBe('staging');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8080);
  });

  it('treats an empty port as unset', () => {
    expect(loadAppConfig({ API_PORT: '   ' }).port).toBe(DEFAULT_PORT);
  });

  it.each([['0'], ['65536'], ['-1'], ['8080.5'], ['http'], ['NaN']])(
    'rejects invalid API_PORT %p',
    (value) => {
      expect(() => loadAppConfig({ API_PORT: value })).toThrow(/API_PORT/);
    },
  );

  it('prefixes the API with the documented version segment', () => {
    expect(API_PREFIX).toBe('v1');
  });
});
