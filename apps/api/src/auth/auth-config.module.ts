import { Module } from '@nestjs/common';

import { AUTH_CONFIG } from './auth.constants';
import { loadAuthConfig } from './auth-config';

/**
 * Provides the resolved {@link AuthConfig} as a single instance.
 *
 * Its own module because `JwtModule.registerAsync` resolves its factory in a
 * separate injection context: giving that context its own copy of the
 * provider would call `loadAuthConfig()` twice. Outside production the second
 * call generates a *different* random secret, so the token service and the
 * JWT service would disagree about the signing key. Importing this module in
 * both places means both see the same object.
 */
@Module({
  providers: [{ provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() }],
  exports: [AUTH_CONFIG],
})
export class AuthConfigModule {}
