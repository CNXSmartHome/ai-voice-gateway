import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

import { IS_PUBLIC_KEY, REQUEST_USER_KEY } from './auth.constants';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Marks a route or controller as reachable without a token.
 *
 * Authentication is applied globally, so this is the only way to opt out and
 * every use of it is greppable in one place. Adding a controller without it
 * yields a protected controller.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Injects the authenticated caller into a handler parameter.
 *
 * Throws rather than returning undefined when no user is present. That only
 * happens if a handler is marked `@Public()` and still asks for a user, which
 * is a wiring mistake: failing loudly is better than handing the handler an
 * undefined it will treat as anonymous.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request: Record<string, unknown> = context.switchToHttp().getRequest();
    const user = request[REQUEST_USER_KEY] as AuthenticatedUser | undefined;

    if (user === undefined) {
      throw new UnauthorizedException();
    }
    return user;
  },
);
