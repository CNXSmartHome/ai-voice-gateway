import { Logger } from '@nestjs/common';

import { PrismaService } from '../src/database/prisma.service';

describe('PrismaService.isReachable', () => {
  let service: PrismaService;

  beforeEach(() => {
    // These tests deliberately simulate driver failures. Silence the logger
    // so a passing run does not print connection errors that look real.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new PrismaService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is true when the probe query succeeds', async () => {
    jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.isReachable()).resolves.toBe(true);
  });

  it('is false when the probe query fails', async () => {
    jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:5432'));

    await expect(service.isReachable()).resolves.toBe(false);
  });

  it('swallows the driver error rather than propagating connection detail', async () => {
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValue(new Error('password authentication failed for user "vg"'));

    // The readiness endpoint is unauthenticated; a thrown driver error would
    // surface the host and credentials in the response.
    await expect(service.isReachable()).resolves.toBe(false);
  });
});
