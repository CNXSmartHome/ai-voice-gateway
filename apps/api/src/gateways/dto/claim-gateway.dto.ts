import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Serial numbers are printed on the device and typed or scanned by a person,
 * so the format is deliberately forgiving about case but strict about the
 * character set: anything outside it cannot be a serial this system issued.
 */
export const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9-]+$/;

export class ClaimGatewayDto {
  @IsString()
  @Length(4, 64)
  @Matches(SERIAL_NUMBER_PATTERN, {
    message: 'serialNumber may contain only letters, digits, and hyphens',
  })
  serialNumber!: string;

  @IsString()
  @Length(1, 64)
  propertyId!: string;

  /**
   * Optional at claim time. The gateway's room is its voice context, so it is
   * accepted here to save a second call, but assignment has its own task
   * (VG-013) and a gateway is useful before it has one.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  roomId?: string;

  /** Defaults to the serial number when the caller does not name the device. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;
}
