import { Injectable } from '@nestjs/common';
import { isCapabilitySupported, type ControlAction } from '@vg/domain';

import type { AuthenticatedUser } from '../auth/authenticated-user';

import type { ResolvedResource } from './resource-resolver.service';

/**
 * What the pipeline is permitted to do with a resolved command.
 *
 * `CONFIRMATION_REQUIRED` is a third answer rather than a flavour of deny
 * because the voice tasks need it to be: VG-026 has to be able to ask "shall
 * I run the evening scene?" and act on the reply. Folding it into `DENY`
 * would mean the only way to express "ask first" is to refuse and hope the
 * caller tries again.
 */
export const POLICY_DECISIONS = ['ALLOW', 'DENY', 'CONFIRMATION_REQUIRED'] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/**
 * Why the policy decided what it did.
 *
 * A stable machine-readable code, not a message. It reaches an AI prompt in
 * VG-026, and prose is not a stable interface.
 */
export type PolicyReason =
  | 'PERMITTED'
  | 'CAPABILITY_NOT_VALID_FOR_KIND'
  | 'CAPABILITY_NOT_DECLARED'
  | 'RESOURCE_DISABLED'
  | 'NOT_A_MEMBER'
  | 'IRREVERSIBLE_ACTION';

export interface PolicyOutcome {
  readonly decision: PolicyDecision;
  readonly reason: PolicyReason;
}

export interface PolicyRequest {
  readonly caller: AuthenticatedUser;
  /** The organization that owns the property the resource sits in. */
  readonly organizationId: string;
  readonly resource: ResolvedResource;
  readonly action: ControlAction;
}

const ALLOWED: PolicyOutcome = { decision: 'ALLOW', reason: 'PERMITTED' };

/**
 * The authorization and safety rules applied to a resolved command (VG-040).
 *
 * Separate from `ControlService` so the rules can be read, reviewed, and
 * tested as rules, rather than inferred from the order of statements in a
 * dispatch method. Every rule here refuses; none of them grants. A command
 * is allowed only by surviving all of them, so a rule added later cannot
 * accidentally widen access.
 *
 * Door, gate, and alarm authorization is deliberately absent.
 * `AI_GOVERNANCE.md` puts that policy behind Product Owner approval and
 * `docs/PRODUCT.md` puts those devices out of MVP scope; the vocabulary in
 * `docs/DEVICE_MODEL.md` has no kind for them, so there is nothing to decide
 * here yet.
 */
@Injectable()
export class PolicyService {
  evaluate(request: PolicyRequest): PolicyOutcome {
    const { caller, organizationId, resource, action } = request;

    // Membership of the owning organization. Checked again here, after
    // ControlService has already checked it, because a policy that assumes
    // its caller was vetted upstream is a policy that fails open the first
    // time someone calls it from somewhere new.
    if (!caller.memberships.some((membership) => membership.organizationId === organizationId)) {
      return { decision: 'DENY', reason: 'NOT_A_MEMBER' };
    }

    // No role check beyond membership. `MEMBER` is the role for residents and
    // guests (docs/API.md), and using the lights is the whole point of giving
    // someone a room. Claiming hardware is the administrative act, not
    // switching it on.

    if (!resource.enabled) {
      return { decision: 'DENY', reason: 'RESOURCE_DISABLED' };
    }

    // The vocabulary rule from docs/DEVICE_MODEL.md: `brightness` is
    // meaningless on a curtain whatever the database will store.
    if (!isCapabilitySupported(resource.kind, action.capability)) {
      return { decision: 'DENY', reason: 'CAPABILITY_NOT_VALID_FOR_KIND' };
    }

    // Valid for the kind, but this particular resource never claimed it. A
    // dimmable-in-principle bulb that reported no `brightness` is not
    // dimmable, and asking the adapter anyway would push the failure down to
    // a provider error nobody can act on.
    if (!resource.capabilities.includes(action.capability)) {
      return { decision: 'DENY', reason: 'CAPABILITY_NOT_DECLARED' };
    }

    // A scene fans out across the villa and has no inverse: there is no
    // command that puts back what `execute` changed. Everything else here is
    // undone by its opposite, so a mistaken `power` costs a second command
    // and a mistaken scene costs an evening. That asymmetry is what warrants
    // asking first.
    if (resource.kind === 'scene') {
      return { decision: 'CONFIRMATION_REQUIRED', reason: 'IRREVERSIBLE_ACTION' };
    }

    return ALLOWED;
  }
}
