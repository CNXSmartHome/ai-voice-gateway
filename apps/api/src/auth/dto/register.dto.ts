import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

/**
 * Minimum password length.
 *
 * Length is the only strength rule enforced. Composition rules (a digit, a
 * symbol) push people toward predictable substitutions without adding real
 * entropy, and NIST SP 800-63B advises against them.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * Upper bound on password length.
 *
 * Not a security rule but a denial-of-service one: each hash costs 64 MiB,
 * and an unbounded input lets a caller choose how much work the server does.
 */
export const MAXIMUM_PASSWORD_LENGTH = 256;

export class RegisterDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(MINIMUM_PASSWORD_LENGTH, MAXIMUM_PASSWORD_LENGTH, {
    message: `password must be between ${String(MINIMUM_PASSWORD_LENGTH)} and ${String(MAXIMUM_PASSWORD_LENGTH)} characters`,
  })
  password!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(1, 200)
  organizationName!: string;
}
