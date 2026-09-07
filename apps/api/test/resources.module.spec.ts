import 'reflect-metadata';

import { AdapterRegistry } from '../src/resources/adapter.registry';
import { HomeAssistantStubAdapter } from '../src/resources/adapters/home-assistant-stub.adapter';
import { ControlService } from '../src/resources/control.service';
import { PolicyService } from '../src/resources/policy.service';
import { ResourceRegistryService } from '../src/resources/resource-registry.service';
import { ResourceResolver } from '../src/resources/resource-resolver.service';
import { ResourcesModule } from '../src/resources/resources.module';

/**
 * The acceptance criterion "callers cannot bypass the control pipeline and
 * call provider adapters directly" is enforced by Nest's module
 * encapsulation, not by convention. This asserts the mechanism.
 *
 * A provider that is not exported cannot be injected by another module, so
 * widening the list below is the only way to make a bypass possible -- and
 * this test makes that a deliberate, visible edit.
 */
describe('ResourcesModule encapsulation', () => {
  const exports = (Reflect.getMetadata('exports', ResourcesModule) ?? []) as unknown[];
  const providers = (Reflect.getMetadata('providers', ResourcesModule) ?? []) as unknown[];

  it('exports exactly the pipeline entry points', () => {
    expect(exports).toEqual([ResourceRegistryService, ControlService]);
  });

  it.each([
    ['the adapter registry', AdapterRegistry],
    ['a concrete adapter', HomeAssistantStubAdapter],
    ['the resolver', ResourceResolver],
    ['the policy service', PolicyService],
  ])('does not export %s', (_label, provider) => {
    expect(exports).not.toContain(provider);
  });

  it('still provides them internally, so ControlService can use them', () => {
    for (const provider of [
      AdapterRegistry,
      HomeAssistantStubAdapter,
      ResourceResolver,
      PolicyService,
    ]) {
      expect(providers).toContain(provider);
    }
  });
});
