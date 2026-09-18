import type { ControlAction } from '@vg/domain';

import type { AuthenticatedUser } from '../src/auth/authenticated-user';
import { PolicyService } from '../src/resources/policy.service';
import type { ResolvedResource } from '../src/resources/resource-resolver.service';

const ORGANIZATION = 'org-1';

function caller(role = 'MEMBER', organizationId = ORGANIZATION): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user@example.test',
    name: 'User',
    memberships: [{ organizationId, role }],
  };
}

function resource(overrides: Partial<ResolvedResource> = {}): ResolvedResource {
  return {
    id: 'res-1',
    propertyId: 'prop-1',
    roomId: 'room-1',
    name: 'Ceiling Light',
    kind: 'light',
    capabilities: ['power', 'brightness'],
    enabled: true,
    binding: { platform: 'home_assistant', externalId: 'light.ceiling' },
    ...overrides,
  };
}

describe('PolicyService', () => {
  const policy = new PolicyService();

  const evaluate = (
    overrides: Partial<ResolvedResource> = {},
    action: ControlAction = { capability: 'power', value: true },
    user = caller(),
  ) =>
    policy.evaluate({
      caller: user,
      organizationId: ORGANIZATION,
      resource: resource(overrides),
      action,
    });

  it('allows a declared capability on an enabled resource', () => {
    expect(evaluate()).toEqual({ decision: 'ALLOW', reason: 'PERMITTED' });
  });

  it('allows a MEMBER to control, because residents and guests use the lights', () => {
    expect(evaluate({}, { capability: 'power', value: true }, caller('MEMBER')).decision).toBe(
      'ALLOW',
    );
  });

  it('denies a caller who is not a member of the owning organization', () => {
    const outsider = caller('OWNER', 'another-org');

    expect(evaluate({}, { capability: 'power', value: true }, outsider)).toEqual({
      decision: 'DENY',
      reason: 'NOT_A_MEMBER',
    });
  });

  it('denies a disabled resource', () => {
    expect(evaluate({ enabled: false })).toEqual({
      decision: 'DENY',
      reason: 'RESOURCE_DISABLED',
    });
  });

  it('denies a capability the kind cannot have', () => {
    // `brightness` is meaningless on a curtain whatever the row says.
    const outcome = evaluate(
      { kind: 'curtain', capabilities: ['power', 'brightness'] },
      { capability: 'brightness', value: 50 },
    );

    expect(outcome).toEqual({ decision: 'DENY', reason: 'CAPABILITY_NOT_VALID_FOR_KIND' });
  });

  it('denies a capability valid for the kind but not declared by the resource', () => {
    const outcome = evaluate({ capabilities: ['power'] }, { capability: 'brightness', value: 50 });

    expect(outcome).toEqual({ decision: 'DENY', reason: 'CAPABILITY_NOT_DECLARED' });
  });

  it('requires confirmation for a scene, which has no inverse command', () => {
    const outcome = evaluate(
      { kind: 'scene', capabilities: ['execute'] },
      { capability: 'execute', value: true },
    );

    expect(outcome).toEqual({
      decision: 'CONFIRMATION_REQUIRED',
      reason: 'IRREVERSIBLE_ACTION',
    });
  });

  it('checks membership before anything about the resource', () => {
    // An outsider naming a disabled resource with an invalid capability learns
    // only that they are not a member: the refusal must not describe a
    // resource they cannot see.
    const outcome = evaluate(
      { enabled: false, kind: 'curtain' },
      { capability: 'brightness', value: 50 },
      caller('OWNER', 'another-org'),
    );

    expect(outcome.reason).toBe('NOT_A_MEMBER');
  });
});
