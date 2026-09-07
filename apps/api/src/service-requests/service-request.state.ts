import { BadRequestException } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';

const ALLOWED: Readonly<Record<ServiceRequestStatus, readonly ServiceRequestStatus[]>> = {
  NEW: ['ACKNOWLEDGED', 'CANCELLED', 'REJECTED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

export function assertServiceRequestTransition(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): void {
  if (!ALLOWED[from].includes(to)) {
    throw new BadRequestException(`Invalid service request transition: ${from} -> ${to}`);
  }
}
