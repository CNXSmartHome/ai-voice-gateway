import { Inject, Injectable } from '@nestjs/common';
import type { Platform } from '@vg/domain';

import { SMART_HOME_ADAPTERS, type SmartHomeAdapter } from './adapter.port';

/**
 * Resolves a platform to the adapter that speaks it.
 *
 * Not exported from `ResourcesModule`. Reaching an adapter is the last step
 * of `ControlService`, and a caller that could inject this registry could
 * dispatch without resolving, without an authorization check, and without a
 * policy decision -- which is exactly the bypass VG-040 exists to prevent.
 * The encapsulation is the mechanism; `resources.module.spec.ts` asserts it.
 */
@Injectable()
export class AdapterRegistry {
  private readonly byPlatform: ReadonlyMap<Platform, SmartHomeAdapter>;

  constructor(@Inject(SMART_HOME_ADAPTERS) adapters: readonly SmartHomeAdapter[]) {
    const byPlatform = new Map<Platform, SmartHomeAdapter>();
    for (const adapter of adapters) {
      // Two adapters for one platform means the dispatch target depends on
      // provider registration order, which is not something a reviewer can
      // see. Failing at construction makes it a startup error instead.
      if (byPlatform.has(adapter.platform)) {
        throw new Error(`Duplicate adapter registered for platform: ${adapter.platform}`);
      }
      byPlatform.set(adapter.platform, adapter);
    }
    this.byPlatform = byPlatform;
  }

  /**
   * The adapter for a platform, or null when none is registered.
   *
   * Null rather than a throw: a resource may be bound to a platform whose
   * adapter is not deployed in this environment, and the pipeline reports
   * that as a failed command rather than a crash.
   */
  get(platform: Platform): SmartHomeAdapter | null {
    return this.byPlatform.get(platform) ?? null;
  }

  /** Platforms with a registered adapter. For diagnostics and tests. */
  platforms(): readonly Platform[] {
    return [...this.byPlatform.keys()];
  }
}
