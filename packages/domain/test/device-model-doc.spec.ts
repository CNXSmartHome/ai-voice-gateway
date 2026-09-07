import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CAPABILITIES, CAPABILITIES_BY_DEVICE_TYPE } from '../src/capability';
import { DEVICE_TYPES } from '../src/device-type';
import { RESOURCE_KINDS } from '../src/resource';

/**
 * docs/DEVICE_MODEL.md is the specification; this package is its
 * implementation. These tests fail when the two drift apart.
 */
const DOC_PATH = join(__dirname, '..', '..', '..', 'docs', 'DEVICE_MODEL.md');
const doc = readFileSync(DOC_PATH, 'utf8');

/** Bullet entries directly under a heading, stopping at the next heading. */
function bulletsUnder(heading: string): string[] {
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`heading not found in DEVICE_MODEL.md: ${heading}`);
  }

  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    const match = /^-\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) bullets.push(match[1]);
  }
  return bullets;
}

describe('DEVICE_MODEL.md contract', () => {
  it('implements exactly the documented device types', () => {
    expect([...DEVICE_TYPES].sort()).toEqual(bulletsUnder('## MVP device types').sort());
  });

  it.each([
    ['### Light', 'light'],
    ['### Climate', 'climate'],
    ['### Curtain', 'curtain'],
  ] as const)('implements the documented %s capabilities', (heading, deviceType) => {
    const documented = bulletsUnder(heading);
    const implemented = CAPABILITIES_BY_DEVICE_TYPE[deviceType];
    for (const capability of documented) {
      expect(implemented).toContain(capability);
    }
  });

  it('implements the documented common capabilities on every controllable type', () => {
    for (const capability of bulletsUnder('### Common')) {
      for (const deviceType of DEVICE_TYPES) {
        if (deviceType === 'scene') continue;
        expect(CAPABILITIES_BY_DEVICE_TYPE[deviceType]).toContain(capability);
      }
    }
  });

  it('declares no capability the document does not define', () => {
    const documented = new Set([
      ...bulletsUnder('### Common'),
      ...bulletsUnder('### Light'),
      ...bulletsUnder('### Climate'),
      ...bulletsUnder('### Curtain'),
      ...bulletsUnder('### Scene'),
    ]);
    for (const capability of CAPABILITIES) {
      expect([...documented]).toContain(capability);
    }
  });

  it('gives resources exactly the documented device types as kinds', () => {
    // docs/DEVICE_MODEL.md: "Resource kinds are exactly the MVP device
    // types." A second vocabulary would be two places to add `fan` to.
    expect([...RESOURCE_KINDS].sort()).toEqual(bulletsUnder('## MVP device types').sort());
  });

  it('documents the resource concept the registry implements', () => {
    expect(doc).toMatch(/^## Resources$/m);
    expect(doc).toMatch(/Villa\*\* = Property/);
    expect(doc).toMatch(/Zone\*\* = Room/);
  });
});
