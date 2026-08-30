import { PLATFORMS, isPlatform } from '../src/platform';

describe('platforms', () => {
  it('ships only the Tuya adapter in the MVP', () => {
    expect([...PLATFORMS]).toEqual(['tuya']);
  });

  it('accepts tuya', () => {
    expect(isPlatform('tuya')).toBe(true);
  });

  it.each([['smartthings'], ['google_home'], ['matter'], ['Tuya'], [null]])(
    'rejects out-of-scope platform %p',
    (value) => {
      expect(isPlatform(value)).toBe(false);
    },
  );
});
