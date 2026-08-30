import { IsEmail, IsString, MaxLength } from 'class-validator';

import { MAXIMUM_PASSWORD_LENGTH } from './register.dto';

/**
 * Login deliberately does not apply the registration length rule.
 *
 * Rejecting a short password before checking it would tell an attacker that
 * no account can have that password, and would lock out any account created
 * before the rule changed. Only the upper bound is enforced, because that
 * one exists to cap hashing work rather than to judge the credential.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MaxLength(MAXIMUM_PASSWORD_LENGTH)
  password!: string;
}
