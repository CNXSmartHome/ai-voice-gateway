import { BadRequestException } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';

import { assertServiceRequestTransition } from '../src/service-requests/service-request.state';

describe('service request state machine', () => {
  it.each([
    [ServiceRequestStatus.NEW, ServiceRequestStatus.ACKNOWLEDGED],
    [ServiceRequestStatus.NEW, ServiceRequestStatus.CANCELLED],
    [ServiceRequestStatus.ACKNOWLEDGED, ServiceRequestStatus.IN_PROGRESS],
    [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.COMPLETED],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertServiceRequestTransition(from, to)).not.toThrow();
  });

  it.each([
    [ServiceRequestStatus.NEW, ServiceRequestStatus.COMPLETED],
    [ServiceRequestStatus.COMPLETED, ServiceRequestStatus.NEW],
    [ServiceRequestStatus.CANCELLED, ServiceRequestStatus.IN_PROGRESS],
    [ServiceRequestStatus.REJECTED, ServiceRequestStatus.ACKNOWLEDGED],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => assertServiceRequestTransition(from, to)).toThrow(BadRequestException);
  });
});
