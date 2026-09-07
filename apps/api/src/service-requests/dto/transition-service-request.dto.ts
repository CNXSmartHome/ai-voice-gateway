import { IsEnum } from 'class-validator';
import { ServiceRequestStatus } from '@prisma/client';

export class TransitionServiceRequestDto {
  @IsEnum(ServiceRequestStatus)
  status!: ServiceRequestStatus;
}
