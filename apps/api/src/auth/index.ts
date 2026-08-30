export { AUTH_CONFIG, IS_PUBLIC_KEY, REQUEST_USER_KEY } from './auth.constants';
export { AuthModule } from './auth.module';
export { AuthService, type AuthenticationResult, type UserProfile } from './auth.service';
export {
  DEFAULT_ACCESS_TTL_SECONDS,
  DEFAULT_ISSUER,
  MINIMUM_SECRET_LENGTH,
  loadAuthConfig,
  type AuthConfig,
} from './auth-config';
export type { AuthenticatedMembership, AuthenticatedUser } from './authenticated-user';
export { CurrentUser, Public } from './decorators';
export { JwtAuthGuard } from './jwt-auth.guard';
export { PasswordService } from './password.service';
export { TokenService, type AccessTokenClaims, type IssuedToken } from './token.service';
