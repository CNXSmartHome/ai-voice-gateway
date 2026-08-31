import { IsOptional, IsString, Length } from 'class-validator';

import { IsTimezone } from './is-timezone.validator';

/**
 * Both fields optional, but not both absent — the service rejects an empty
 * change rather than reporting success for having done nothing.
 *
 * `organizationId` is deliberately absent. Moving a property between
 * organizations would move its rooms, gateways, and devices with it, across
 * an authorization boundary, and that is not a rename.
 */
export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  @IsTimezone()
  timezone?: string;
}
