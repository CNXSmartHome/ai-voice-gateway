import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { DatabaseModule } from '../database/database.module';

import { AUTH_CONFIG } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthConfigModule } from './auth-config.module';
import type { AuthConfig } from './auth-config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Authentication (VG-004).
 *
 * `JwtAuthGuard` is registered through `APP_GUARD`, so it runs for every
 * route in the application, not only this module's. That is what makes
 * "authenticated by default" true for controllers added by later tasks.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthConfigModule,
    JwtModule.registerAsync({
      imports: [AuthConfigModule],
      inject: [AUTH_CONFIG],
      useFactory: (config: AuthConfig) => ({
        secret: config.secret,
        // Pinned rather than left to the library's default, so a token
        // presented with a different `alg` header cannot change how it is
        // verified.
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService, PasswordService, AuthConfigModule],
})
export class AuthModule {}
