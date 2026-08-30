import { Test } from '@nestjs/testing';

import { HealthController } from '../src/health/health.controller';
import { HealthService, SERVICE_NAME } from '../src/health/health.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok with service identity', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe(SERVICE_NAME);
    expect(typeof result.version).toBe('string');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.uptimeSeconds)).toBe(true);
  });

  it('does not leak environment or dependency detail', () => {
    const keys = Object.keys(controller.check()).sort();

    expect(keys).toEqual(['service', 'status', 'uptimeSeconds', 'version']);
  });
});
