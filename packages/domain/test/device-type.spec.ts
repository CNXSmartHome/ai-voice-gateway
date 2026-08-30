import { DEVICE_TYPES, isDeviceType } from '../src/device-type';

describe('device types', () => {
  it('declares exactly the five MVP device types', () => {
    expect([...DEVICE_TYPES]).toEqual(['light', 'climate', 'curtain', 'switch', 'scene']);
  });

  it('accepts every declared type', () => {
    for (const type of DEVICE_TYPES) {
      expect(isDeviceType(type)).toBe(true);
    }
  });

  it.each([['lock'], ['camera'], ['LIGHT'], [''], [null], [undefined], [42], [{}]])(
    'rejects %p',
    (value) => {
      expect(isDeviceType(value)).toBe(false);
    },
  );
});
