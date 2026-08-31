import { IsString, Length } from 'class-validator';

/**
 * Rename, and only rename.
 *
 * `organizationId` is deliberately absent, and the validation pipe rejects it
 * as an unknown field. Moving a property between organizations would carry
 * its rooms, gateways, and devices across an authorization boundary, and that
 * is not a rename.
 */
export class UpdatePropertyDto {
  @IsString()
  @Length(1, 200)
  name!: string;
}
