import { IsOptional, IsString, Length } from 'class-validator';

import { IsTimezone } from './is-timezone.validator';

export class CreatePropertyDto {
  /**
   * Required, because a caller can be a member of more than one organization
   * and the API must never guess which one a property belongs to.
   */
  @IsString()
  @Length(1, 64)
  organizationId!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  /**
   * IANA zone, defaulting to UTC in the schema.
   *
   * A property is a physical place, and everything time-shaped that follows
   * — schedules, "goodnight", an evening scene — is wrong without it. Set
   * here rather than left to a follow-up, since the column has existed since
   * VG-003 with nothing able to write it.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @IsTimezone()
  timezone?: string;
}
