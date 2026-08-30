import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { AuthService, type AuthenticationResult, type UserProfile } from './auth.service';
import type { AuthenticatedUser } from './authenticated-user';
import { CurrentUser, Public } from './decorators';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/** Wire shape returned by register and login. */
interface AuthenticationResponse {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly user: UserProfile;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Creates an organization and its first user.
   *
   * Public: there is no caller to authenticate yet. This is the one route
   * that creates an organization; joining an existing one needs an invitation
   * flow, which is not part of this task.
   */
  @Public()
  @Post('register')
  async register(@Body() body: RegisterDto): Promise<AuthenticationResponse> {
    return toResponse(await this.auth.register(body));
  }

  /**
   * Exchanges credentials for an access token.
   *
   * 200 rather than 201: nothing is created, and a token is not a resource
   * the caller can address.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() body: LoginDto): Promise<AuthenticationResponse> {
    return toResponse(await this.auth.login(body));
  }

  /**
   * Returns the authenticated caller.
   *
   * Not marked `@Public()`, so the global guard applies: this is also the
   * route the mobile app uses to check whether a stored token is still good.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

function toResponse(result: AuthenticationResult): AuthenticationResponse {
  return {
    accessToken: result.token.accessToken,
    tokenType: result.token.tokenType,
    expiresIn: result.token.expiresInSeconds,
    user: result.user,
  };
}
