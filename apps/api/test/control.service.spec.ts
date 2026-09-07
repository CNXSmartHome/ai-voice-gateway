import { NotFoundException } from '@nestjs/common';
import type { ControlAction, ResourceTarget } from '@vg/domain';

import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import type { PrismaService } from '../src/database/prisma.service';
import type { AdapterCommand, AdapterResult } from '../src/resources/adapter.port';
import type { AdapterRegistry } from '../src/resources/adapter.registry';
import { ControlService } from '../src/resources/control.service';
import { PolicyService } from '../src/resources/policy.service';
import type { Resolution, ResolvedResource } from '../src/resources/resource-resolver.service';
import type { ResourceResolver } from '../src/resources/resource-resolver.service';

const ORGANIZATION = 'org-1';
const PROPERTY = 'prop-1';

const CALLER: AuthenticatedUser = {
  id: 'user-1',
  email: 'user@example.test',
  name: 'User',
  memberships: [{ organizationId: ORGANIZATION, role: 'MEMBER' }],
};

const TARGET: ResourceTarget = { propertyId: PROPERTY, name: 'Ceiling Light' };
const ACTION: ControlAction = { capability: 'power', value: true };

function resolved(overrides: Partial<ResolvedResource> = {}): ResolvedResource {
  return {
    id: 'res-1',
    propertyId: PROPERTY,
    roomId: 'room-1',
    name: 'Ceiling Light',
    kind: 'light',
    capabilities: ['power', 'brightness'],
    enabled: true,
    binding: { platform: 'home_assistant', externalId: 'light.ceiling' },
    ...overrides,
  };
}

/**
 * An adapter that records what reached it.
 *
 * The point of most of these tests is that it records nothing: "authorization
 * and policy run before dispatch" is only demonstrable by showing the
 * dispatch did not happen.
 */
class SpyAdapter {
  readonly commands: AdapterCommand[] = [];
  result: AdapterResult = { ok: true };

  execute(command: AdapterCommand): Promise<AdapterResult> {
    this.commands.push(command);
    return Promise.resolve(this.result);
  }
}

describe('ControlService', () => {
  let adapter: SpyAdapter;
  let resolution: Resolution;
  let organizationId: string | null;
  let service: ControlService;
  let adapterForPlatform: SpyAdapter | null;

  beforeEach(() => {
    adapter = new SpyAdapter();
    adapterForPlatform = adapter;
    organizationId = ORGANIZATION;
    resolution = { ok: true, resource: resolved() };

    const prisma = {
      property: {
        findUnique: () => Promise.resolve(organizationId === null ? null : { organizationId }),
      },
    } as unknown as PrismaService;

    const resolver = {
      resolve: () => Promise.resolve(resolution),
    } as unknown as ResourceResolver;

    const registry = {
      get: () => adapterForPlatform,
    } as unknown as AdapterRegistry;

    service = new ControlService(prisma, resolver, new PolicyService(), registry);
  });

  it('dispatches an allowed command, carrying the provider identifier', async () => {
    const outcome = await service.control(CALLER, TARGET, ACTION);

    expect(outcome).toEqual({ status: 'DISPATCHED', resourceId: 'res-1' });
    expect(adapter.commands).toEqual([
      { externalId: 'light.ceiling', capability: 'power', value: true },
    ]);
  });

  describe('tenancy', () => {
    it('rejects a property that does not exist', async () => {
      organizationId = null;

      await expect(service.control(CALLER, TARGET, ACTION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(adapter.commands).toHaveLength(0);
    });

    it('rejects a property in an organization the caller does not belong to', async () => {
      organizationId = 'another-org';

      await expect(service.control(CALLER, TARGET, ACTION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(adapter.commands).toHaveLength(0);
    });

    it("gives the same rejection for a missing property as for someone else's", async () => {
      organizationId = null;
      const missing = await service.control(CALLER, TARGET, ACTION).catch((e: Error) => e.message);

      organizationId = 'another-org';
      const foreign = await service.control(CALLER, TARGET, ACTION).catch((e: Error) => e.message);

      expect(missing).toBe(foreign);
    });

    it('refuses a resource that resolved into another property', async () => {
      // Defence in depth: the resolver scopes by property, so this should be
      // unreachable. If it ever is reachable, it must not dispatch.
      resolution = { ok: true, resource: resolved({ propertyId: 'other-property' }) };

      await expect(service.control(CALLER, TARGET, ACTION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(adapter.commands).toHaveLength(0);
    });
  });

  describe('resolution', () => {
    it.each(['NOT_FOUND', 'AMBIGUOUS', 'DISABLED'] as const)(
      'reports %s without dispatching',
      async (reason) => {
        resolution = { ok: false, reason, matched: 2 };

        const outcome = await service.control(CALLER, TARGET, ACTION);

        expect(outcome).toEqual({ status: 'UNRESOLVED', reason, matched: 2 });
        expect(adapter.commands).toHaveLength(0);
      },
    );
  });

  describe('policy runs before dispatch', () => {
    it('refuses a denied command and dispatches nothing', async () => {
      resolution = { ok: true, resource: resolved({ capabilities: ['power'] }) };

      const outcome = await service.control(CALLER, TARGET, {
        capability: 'brightness',
        value: 50,
      });

      expect(outcome).toEqual({
        status: 'REFUSED',
        decision: 'DENY',
        reason: 'CAPABILITY_NOT_DECLARED',
        resourceId: 'res-1',
      });
      expect(adapter.commands).toHaveLength(0);
    });

    it('holds a confirmation-required command at the boundary', async () => {
      resolution = {
        ok: true,
        resource: resolved({ kind: 'scene', capabilities: ['execute'] }),
      };

      const outcome = await service.control(CALLER, TARGET, {
        capability: 'execute',
        value: true,
      });

      expect(outcome).toEqual({
        status: 'CONFIRMATION_REQUIRED',
        reason: 'IRREVERSIBLE_ACTION',
        resourceId: 'res-1',
      });
      // The whole value of a confirmation step is that it has not happened yet.
      expect(adapter.commands).toHaveLength(0);
    });

    it('denies a disabled resource that reached policy, and dispatches nothing', async () => {
      resolution = { ok: true, resource: resolved({ enabled: false }) };

      const outcome = await service.control(CALLER, TARGET, ACTION);

      expect(outcome).toMatchObject({ status: 'REFUSED', reason: 'RESOURCE_DISABLED' });
      expect(adapter.commands).toHaveLength(0);
    });
  });

  describe('dispatch failures', () => {
    it('reports an unbound resource rather than calling an adapter', async () => {
      resolution = { ok: true, resource: resolved({ binding: null }) };

      const outcome = await service.control(CALLER, TARGET, ACTION);

      expect(outcome).toEqual({
        status: 'FAILED',
        reason: 'RESOURCE_NOT_BOUND',
        resourceId: 'res-1',
      });
      expect(adapter.commands).toHaveLength(0);
    });

    it('reports a platform with no adapter deployed', async () => {
      adapterForPlatform = null;

      const outcome = await service.control(CALLER, TARGET, ACTION);

      expect(outcome).toEqual({
        status: 'FAILED',
        reason: 'NO_ADAPTER_FOR_PLATFORM',
        resourceId: 'res-1',
      });
    });

    it('passes a provider failure back without pretending it succeeded', async () => {
      adapter.result = { ok: false, reason: 'UNREACHABLE' };

      const outcome = await service.control(CALLER, TARGET, ACTION);

      expect(outcome).toEqual({
        status: 'FAILED',
        reason: 'UNREACHABLE',
        resourceId: 'res-1',
      });
    });
  });
});
