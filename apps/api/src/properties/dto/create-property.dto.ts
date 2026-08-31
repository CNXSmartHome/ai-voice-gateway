import { IsString, Length } from 'class-validator';

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
}
