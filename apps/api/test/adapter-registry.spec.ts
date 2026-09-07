import type { Platform } from '@vg/domain';

import type {
  AdapterCommand,
  AdapterResult,
  SmartHomeAdapter,
} from '../src/resources/adapter.port';
import { AdapterRegistry } from '../src/resources/adapter.registry';

function adapter(platform: Platform): SmartHomeAdapter {
  return {
    platform,
    execute: (_command: AdapterCommand): Promise<AdapterResult> => Promise.resolve({ ok: true }),
  };
}

describe('AdapterRegistry', () => {
  it('resolves a platform to the adapter registered for it', () => {
    const homeAssistant = adapter('home_assistant');
    const registry = new AdapterRegistry([adapter('tuya'), homeAssistant]);

    expect(registry.get('home_assistant')).toBe(homeAssistant);
  });

  it('returns null for a platform with no adapter deployed', () => {
    const registry = new AdapterRegistry([adapter('home_assistant')]);

    expect(registry.get('tuya')).toBeNull();
  });

  it('refuses two adapters for one platform at construction', () => {
    // Otherwise the dispatch target depends on provider registration order,
    // which no reviewer can see in a diff.
    expect(() => new AdapterRegistry([adapter('tuya'), adapter('tuya')])).toThrow(
      /Duplicate adapter/,
    );
  });

  it('is keyed only by platform, so no provider type crosses the boundary', () => {
    const registry = new AdapterRegistry([adapter('tuya'), adapter('home_assistant')]);

    expect([...registry.platforms()].sort()).toEqual(['home_assistant', 'tuya']);
  });
});
