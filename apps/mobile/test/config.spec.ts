import { API_URL_VARIABLE, ApiConfigError, resolveApiConfig } from '../src/api/config';

describe('resolveApiConfig', () => {
  it('accepts an origin and normalises the trailing slash away', () => {
    expect(resolveApiConfig({ [API_URL_VARIABLE]: 'https://api.example.com' })).toEqual({
      baseUrl: 'https://api.example.com',
    });
    expect(resolveApiConfig({ [API_URL_VARIABLE]: 'https://api.example.com/' })).toEqual({
      baseUrl: 'https://api.example.com',
    });
    expect(resolveApiConfig({ [API_URL_VARIABLE]: 'https://api.example.com/edge//' })).toEqual({
      baseUrl: 'https://api.example.com/edge',
    });
  });

  it('accepts http, because development points at a machine on the LAN', () => {
    expect(resolveApiConfig({ [API_URL_VARIABLE]: 'http://192.168.1.20:3000' })).toEqual({
      baseUrl: 'http://192.168.1.20:3000',
    });
  });

  it('ignores surrounding whitespace, which a copied .env line often carries', () => {
    expect(resolveApiConfig({ [API_URL_VARIABLE]: '  https://api.example.com  ' })).toEqual({
      baseUrl: 'https://api.example.com',
    });
  });

  // The point of failing here rather than at the first request: the message
  // names the variable, so whoever built the bundle knows what they forgot.
  it('names the variable when it is missing or blank', () => {
    expect(() => resolveApiConfig({})).toThrow(ApiConfigError);
    expect(() => resolveApiConfig({})).toThrow(API_URL_VARIABLE);
    expect(() => resolveApiConfig({ [API_URL_VARIABLE]: '   ' })).toThrow(API_URL_VARIABLE);
  });

  it('rejects anything that is not an http(s) origin', () => {
    expect(() => resolveApiConfig({ [API_URL_VARIABLE]: 'api.example.com' })).toThrow(
      ApiConfigError,
    );
    expect(() => resolveApiConfig({ [API_URL_VARIABLE]: 'ftp://api.example.com' })).toThrow(
      ApiConfigError,
    );
    expect(() =>
      resolveApiConfig({ [API_URL_VARIABLE]: 'https://api.example.com?debug=1' }),
    ).toThrow(ApiConfigError);
    expect(() => resolveApiConfig({ [API_URL_VARIABLE]: 'https://api.example.com#x' })).toThrow(
      ApiConfigError,
    );
  });
});
