import {
  CAPABILITIES,
  CAPABILITIES_BY_DEVICE_TYPE,
  isCapability,
  isCapabilitySupported,
  listDeviceTypes,
} from '../src/capability';
import { DEVICE_TYPES } from '../src/device-type';

describe('canonical capabilities', () => {
  it('declares the capability set from the device model', () => {
    expect([...CAPABILITIES]).toEqual([
      'power',
      'brightness',
      'color_temperature',
      'rgb',
      'target_temperature',
      'current_temperature',
      'hvac_mode',
      'fan_speed',
      'position',
      'open',
      'close',
      'stop',
      'execute',
    ]);
  });

  it('accepts every declared capability', () => {
    for (const capability of CAPABILITIES) {
      expect(isCapability(capability)).toBe(true);
    }
  });

  it.each([['switch_1'], ['bright_value_v2'], ['temp_set'], ['POWER'], [null], [7]])(
    'rejects provider-specific or malformed name %p',
    (value) => {
      expect(isCapability(value)).toBe(false);
    },
  );
});

describe('capability-to-device-type mapping', () => {
  it('covers every device type', () => {
    expect(Object.keys(CAPABILITIES_BY_DEVICE_TYPE).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it('maps only canonical capability names', () => {
    for (const capabilities of Object.values(CAPABILITIES_BY_DEVICE_TYPE)) {
      for (const capability of capabilities) {
        expect(isCapability(capability)).toBe(true);
      }
    }
  });

  it('gives every controllable type a power capability', () => {
    for (const type of DEVICE_TYPES) {
      if (type === 'scene') continue;
      expect(isCapabilitySupported(type, 'power')).toBe(true);
    }
  });

  it('models a scene as executable rather than powerable', () => {
    expect(isCapabilitySupported('scene', 'execute')).toBe(true);
    expect(isCapabilitySupported('scene', 'power')).toBe(false);
  });

  it.each([
    ['light', 'brightness', true],
    ['light', 'color_temperature', true],
    ['light', 'rgb', true],
    ['light', 'target_temperature', false],
    ['climate', 'hvac_mode', true],
    ['climate', 'fan_speed', true],
    ['climate', 'brightness', false],
    ['curtain', 'position', true],
    ['curtain', 'stop', true],
    ['curtain', 'rgb', false],
    ['switch', 'power', true],
    ['switch', 'brightness', false],
  ] as const)('%s supports %s = %p', (type, capability, expected) => {
    expect(isCapabilitySupported(type, capability)).toBe(expected);
  });

  it('exposes the device types for exhaustive iteration', () => {
    expect(listDeviceTypes()).toEqual(DEVICE_TYPES);
  });

  it('is immutable at runtime', () => {
    expect(Object.isFrozen(CAPABILITIES_BY_DEVICE_TYPE)).toBe(true);
  });
});
