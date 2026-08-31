import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Query parameters for the gateway list.
 *
 * `propertyId` narrows the result and nothing else. A property the caller
 * cannot see yields an empty list rather than an error, so the parameter
 * cannot be used to test whether a property id is real.
 */
export class ListGatewaysDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  propertyId?: string;
}
