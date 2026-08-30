/**
 * The caller identified by a verified access token.
 *
 * This is what downstream tasks consume through `@CurrentUser()`. It carries
 * no password material, and memberships are included because authorization
 * decisions (VG-005 onwards) resolve an organization from the caller.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly memberships: readonly AuthenticatedMembership[];
}

export interface AuthenticatedMembership {
  readonly organizationId: string;
  readonly role: string;
}
