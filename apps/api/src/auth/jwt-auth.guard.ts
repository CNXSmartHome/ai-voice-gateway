import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, REQUEST_USER_KEY } from './auth.constants';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Authenticates every request unless the route is explicitly `@Public()`.
 *
 * Registered globally in `AuthModule`, so the default for any route added
 * later is "protected". The alternative — decorating each controller — makes
 * the failure mode a forgotten decorator on an endpoint that then serves
 * data to anyone.
 *
 * Fails closed throughout: a missing header, an unparseable header, a token
 * that does not verify, and a token whose user no longer exists or has been
 * disabled all produce the same 401 with no detail.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;

    const request: Record<string, unknown> = context.switchToHttp().getRequest();
    const token = extractBearerToken(request);
    if (token === null) throw new UnauthorizedException();

    const claims = this.tokens.verifyAccessToken(token);
    if (claims === null) throw new UnauthorizedException();

    // The token proves who signed in; the database decides whether they may
    // still act. A user disabled or deleted after a token was issued must
    // stop being served before that token expires.
    const user = await this.auth.findActiveUser(claims.sub);
    if (user === null) throw new UnauthorizedException();

    request[REQUEST_USER_KEY] = user;
    return true;
  }

  /**
   * True only when the route is explicitly marked public.
   *
   * `getAllAndOverride` lets a handler opt out under a protected controller.
   * Anything other than a literal `true` — absent metadata, or a value of an
   * unexpected type — is treated as protected.
   */
  private isPublic(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<unknown>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic === true;
  }
}

/**
 * Reads the bearer token from the Authorization header.
 *
 * The scheme is compared case-insensitively per RFC 7235, but the token
 * itself is taken verbatim — trimming or otherwise repairing it would let a
 * subtly malformed credential through.
 */
function extractBearerToken(request: Record<string, unknown>): string | null {
  const headers = request.headers;
  if (typeof headers !== 'object' || headers === null) return null;

  const header = (headers as Record<string, unknown>).authorization;
  if (typeof header !== 'string') return null;
  if (header.length <= BEARER_PREFIX.length) return null;
  if (header.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX.toLowerCase()) {
    return null;
  }

  const token = header.slice(BEARER_PREFIX.length);
  return token === '' ? null : token;
}
