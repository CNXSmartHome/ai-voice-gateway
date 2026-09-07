/**
 * The public surface of the resource registry and control pipeline.
 *
 * Adapters, the adapter registry, and the resolver are deliberately absent:
 * see the export list in `resources.module.ts` for why. Types are re-exported
 * because callers have to describe outcomes; the classes that could dispatch
 * are not.
 */
export { ResourcesModule } from './resources.module';
export { ControlService, type ControlOutcome } from './control.service';
export {
  ResourceRegistryService,
  REGISTER_ROLES,
  type ListResourcesFilter,
  type RegisterResourceInput,
} from './resource-registry.service';
export { POLICY_DECISIONS, type PolicyDecision, type PolicyReason } from './policy.service';
export type { ResolutionFailure } from './resource-resolver.service';
export { RESOURCE_SELECT, toResourceView, type ResourceView } from './resource.view';
export type { AdapterCommand, AdapterResult, SmartHomeAdapter } from './adapter.port';
