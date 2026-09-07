import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { SMART_HOME_ADAPTERS, type SmartHomeAdapter } from './adapter.port';
import { AdapterRegistry } from './adapter.registry';
import { HomeAssistantStubAdapter } from './adapters/home-assistant-stub.adapter';
import { ControlService } from './control.service';
import { PolicyService } from './policy.service';
import { ResourceRegistryService } from './resource-registry.service';
import { ResourceResolver } from './resource-resolver.service';

/**
 * The resource registry and control pipeline (VG-040).
 *
 * The export list is the security boundary, not a convenience. `ControlService`
 * is the only way to reach an adapter, so `AdapterRegistry`, the adapters
 * themselves, `ResourceResolver`, and `PolicyService` are providers and not
 * exports: another module cannot inject one and dispatch a command that
 * skipped the tenancy check, the resolution step, or the policy decision.
 *
 * That is the mechanism behind "callers cannot bypass the control pipeline".
 * `test/resources.module.spec.ts` asserts the list below, so widening it is a
 * deliberate act that shows up in a diff rather than a side effect of needing
 * something in a hurry.
 *
 * No controller. VG-040 defines the seam; the endpoints that use it are
 * VG-041 (semantic actions) and the AI tool layer in VG-020, and adding a
 * route here would be a public API surface this task has no acceptance
 * criteria for.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    ControlService,
    ResourceRegistryService,
    ResourceResolver,
    PolicyService,
    AdapterRegistry,
    HomeAssistantStubAdapter,
    {
      provide: SMART_HOME_ADAPTERS,
      // The Tuya adapter joins this list in VG-009/VG-010. Until then the
      // registry holds one stub, which is enough to prove the boundary is
      // provider-independent and nothing more.
      useFactory: (homeAssistant: HomeAssistantStubAdapter): readonly SmartHomeAdapter[] => [
        homeAssistant,
      ],
      inject: [HomeAssistantStubAdapter],
    },
  ],
  exports: [ResourceRegistryService, ControlService],
})
export class ResourcesModule {}
