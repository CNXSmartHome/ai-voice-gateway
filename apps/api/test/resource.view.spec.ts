import { Capability as DbCapability, DeviceType as DbDeviceType } from '@prisma/client';

import { RESOURCE_SELECT, toResourceView, type ResourceRow } from '../src/resources/resource.view';

const EXTERNAL_ID = 'light.ceiling';

const row: ResourceRow = {
  id: 'res-1',
  propertyId: 'prop-1',
  roomId: 'room-1',
  name: 'Ceiling Light',
  kind: DbDeviceType.LIGHT,
  capabilities: [DbCapability.POWER, DbCapability.BRIGHTNESS],
  enabled: true,
  createdAt: new Date('2026-09-07T10:00:00.000Z'),
  updatedAt: new Date('2026-09-07T10:00:00.000Z'),
};

describe('resource view', () => {
  it('translates storage enums to the canonical vocabulary', () => {
    const view = toResourceView(row);

    expect(view.kind).toBe('light');
    expect(view.capabilities).toEqual(['power', 'brightness']);
  });

  it('renders timestamps as ISO strings', () => {
    expect(toResourceView(row).createdAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('selects no part of the provider binding', () => {
    // The binding relation is not in the select at all, so a column added to
    // ResourceBinding later cannot reach a client by being overlooked.
    expect(Object.keys(RESOURCE_SELECT)).not.toContain('binding');
    expect(Object.keys(RESOURCE_SELECT)).not.toContain('platform');
    expect(Object.keys(RESOURCE_SELECT)).not.toContain('externalId');
  });

  it('exposes no provider identifier, whatever the row carried', () => {
    // Serialized rather than key-checked: this is the assertion that would
    // fail if a nested object smuggled the identifier through.
    const serialized = JSON.stringify(
      toResourceView({ ...row } as ResourceRow & { externalId?: string }),
    );

    expect(serialized).not.toContain(EXTERNAL_ID);
    expect(serialized).not.toContain('home_assistant');
    expect(serialized).not.toContain('tuya');
  });

  it('has exactly the documented public fields', () => {
    expect(Object.keys(toResourceView(row)).sort()).toEqual([
      'capabilities',
      'createdAt',
      'enabled',
      'id',
      'kind',
      'name',
      'propertyId',
      'roomId',
      'updatedAt',
    ]);
  });
});
