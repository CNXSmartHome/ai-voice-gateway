import { PLATFORMS, isPlatform } from '../src/platform';

describe('platforms', () => {
  it('ships the Tuya adapter and the Home Assistant boundary', () => {
    // Still an exact list, not a superset check: adding a platform stays a
    // deliberate edit. `home_assistant` was added by VG-040 so that provider
    // independence is testable — a registry with one platform in it cannot
    // demonstrate that no provider assumption leaked into the pipeline. The
    // adapter registered under it is a stub; the real integration is its own
    // task.
    expect([...PLATFORMS]).toEqual(['tuya', 'home_assistant']);
  });

  it.each([['tuya'], ['home_assistant']])('accepts %s', (value) => {
    expect(isPlatform(value)).toBe(true);
  });

  it.each([['smartthings'], ['google_home'], ['matter'], ['Tuya'], ['HOME_ASSISTANT'], [null]])(
    'rejects out-of-scope platform %p',
    (value) => {
      expect(isPlatform(value)).toBe(false);
    },
  );
});
