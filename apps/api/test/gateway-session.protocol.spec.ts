import {
  GATEWAY_AUTH_SCHEME,
  MAX_FIRMWARE_VERSION_LENGTH,
  MAX_FRAME_BYTES,
  parseAuthorization,
  parseInboundMessage,
  serializeOutbound,
} from '../src/gateways/session/gateway-session.protocol';

describe('parseAuthorization', () => {
  it('reads a serial number and secret', () => {
    expect(parseAuthorization('Gateway VG100-0001:s3cr3t')).toEqual({
      serialNumber: 'VG100-0001',
      secret: 's3cr3t',
    });
  });

  it('accepts the scheme case-insensitively', () => {
    // RFC 7235 defines the scheme as case-insensitive.
    expect(parseAuthorization('gateway VG100-0001:s3cr3t')).not.toBeNull();
  });

  it('splits on the first colon only', () => {
    // Serial numbers cannot contain a colon (VG-005 constrains the charset),
    // so the first one is unambiguous and the secret may contain more.
    expect(parseAuthorization('Gateway VG100-0001:a:b:c')).toEqual({
      serialNumber: 'VG100-0001',
      secret: 'a:b:c',
    });
  });

  it('does not accept a user bearer token', () => {
    // The two credential types must never be interchangeable: a stolen user
    // token must not open a device session.
    expect(parseAuthorization('Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc')).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['a non-string', 12345],
    ['empty', ''],
    ['the scheme alone', GATEWAY_AUTH_SCHEME],
    ['the scheme and a space', `${GATEWAY_AUTH_SCHEME} `],
    ['no separator', 'Gateway VG100-0001'],
    ['an empty serial', 'Gateway :secret'],
    ['an empty secret', 'Gateway VG100-0001:'],
    ['a leading separator', 'Gateway :'],
    ['a different scheme', 'Basic dXNlcjpwYXNz'],
  ])('rejects %s', (_label, header) => {
    expect(parseAuthorization(header)).toBeNull();
  });
});

describe('parseInboundMessage', () => {
  it('parses a heartbeat', () => {
    expect(parseInboundMessage('{"type":"heartbeat"}')).toEqual({ type: 'heartbeat' });
  });

  it('parses a heartbeat carrying a firmware version', () => {
    expect(parseInboundMessage('{"type":"heartbeat","firmwareVersion":"1.2.3"}')).toEqual({
      type: 'heartbeat',
      firmwareVersion: '1.2.3',
    });
  });

  it('accepts a Buffer as well as a string', () => {
    expect(parseInboundMessage(Buffer.from('{"type":"heartbeat"}', 'utf8'))).toEqual({
      type: 'heartbeat',
    });
  });

  it('treats an explicit null firmware version as absent', () => {
    expect(parseInboundMessage('{"type":"heartbeat","firmwareVersion":null}')).toEqual({
      type: 'heartbeat',
    });
  });

  it.each([
    ['empty', ''],
    ['not JSON', 'heartbeat'],
    ['truncated JSON', '{"type":"heart'],
    ['a JSON array', '[{"type":"heartbeat"}]'],
    ['a JSON string', '"heartbeat"'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
    ['an unknown type', '{"type":"shutdown"}'],
    ['a missing type', '{"firmwareVersion":"1.0.0"}'],
    ['a non-string type', '{"type":1}'],
    ['a non-string firmware version', '{"type":"heartbeat","firmwareVersion":123}'],
    ['an empty firmware version', '{"type":"heartbeat","firmwareVersion":""}'],
  ])('rejects %s', (_label, raw) => {
    // An unparseable frame means the two ends are out of step. The caller
    // closes the socket rather than ignoring it, so the mismatch surfaces.
    expect(parseInboundMessage(raw)).toBeNull();
  });

  it('rejects a firmware version beyond the length limit', () => {
    const tooLong = 'v'.repeat(MAX_FIRMWARE_VERSION_LENGTH + 1);

    expect(parseInboundMessage(`{"type":"heartbeat","firmwareVersion":"${tooLong}"}`)).toBeNull();
  });

  it('accepts a firmware version at exactly the limit', () => {
    const atLimit = 'v'.repeat(MAX_FIRMWARE_VERSION_LENGTH);

    expect(parseInboundMessage(`{"type":"heartbeat","firmwareVersion":"${atLimit}"}`)).toEqual({
      type: 'heartbeat',
      firmwareVersion: atLimit,
    });
  });

  it('rejects an oversized frame', () => {
    // A hostile client must not be able to make the server hold an arbitrary
    // amount of memory before the frame is even understood.
    const padding = 'x'.repeat(MAX_FRAME_BYTES);

    expect(parseInboundMessage(`{"type":"heartbeat","firmwareVersion":"${padding}"}`)).toBeNull();
  });

  it('ignores unknown fields rather than failing', () => {
    // Forward compatibility in one direction: newer firmware may send fields
    // this server does not know, and should still be counted as alive.
    expect(parseInboundMessage('{"type":"heartbeat","uptime":123}')).toEqual({
      type: 'heartbeat',
    });
  });
});

describe('serializeOutbound', () => {
  it('serializes a ready frame', () => {
    const frame = serializeOutbound({
      type: 'ready',
      gatewayId: 'gw_1',
      roomId: 'room_1',
      heartbeatIntervalSeconds: 30,
    });

    expect(JSON.parse(frame)).toEqual({
      type: 'ready',
      gatewayId: 'gw_1',
      roomId: 'room_1',
      heartbeatIntervalSeconds: 30,
    });
  });

  it('serializes an acknowledgement', () => {
    const frame = JSON.parse(
      serializeOutbound({ type: 'heartbeat_ack', serverTime: '2026-08-30T00:00:00.000Z' }),
    ) as Record<string, unknown>;

    expect(frame.type).toBe('heartbeat_ack');
  });

  it('sends no serial number or secret to the device', () => {
    // The device already knows its own credentials; echoing them back only
    // creates another place they can leak from.
    const frame = serializeOutbound({
      type: 'ready',
      gatewayId: 'gw_1',
      roomId: null,
      heartbeatIntervalSeconds: 30,
    });

    expect(frame).not.toMatch(/secret|serialNumber|secretHash/i);
  });
});
