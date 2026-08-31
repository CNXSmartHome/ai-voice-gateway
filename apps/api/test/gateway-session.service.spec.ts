import { GatewaySecretService } from '../src/gateways/gateway-secret.service';
import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_PATH,
  loadGatewaySessionConfig,
} from '../src/gateways/session/gateway-session.config';
import { GatewaySessionService } from '../src/gateways/session/gateway-session.service';
import type { PrismaService } from '../src/database/prisma.service';

describe('loadGatewaySessionConfig', () => {
  it('applies defaults', () => {
    const config = loadGatewaySessionConfig({});

    expect(config.path).toBe(DEFAULT_PATH);
    expect(config.heartbeatIntervalSeconds).toBe(DEFAULT_HEARTBEAT_INTERVAL_SECONDS);
  });

  it('reads the path and interval from the environment', () => {
    const config = loadGatewaySessionConfig({
      GATEWAY_WS_PATH: '/v1/custom/session',
      GATEWAY_HEARTBEAT_INTERVAL_SECONDS: '10',
    });

    expect(config.path).toBe('/v1/custom/session');
    expect(config.heartbeatIntervalSeconds).toBe(10);
  });

  it('derives a timeout longer than the interval', () => {
    // Configuring the two separately would allow a timeout shorter than the
    // interval, which would kill every healthy connection.
    const config = loadGatewaySessionConfig({ GATEWAY_HEARTBEAT_INTERVAL_SECONDS: '15' });

    expect(config.heartbeatTimeoutSeconds).toBeGreaterThan(config.heartbeatIntervalSeconds);
  });

  it('rejects a path that cannot match an upgrade request', () => {
    // Would look like a network fault rather than a typo.
    expect(() => loadGatewaySessionConfig({ GATEWAY_WS_PATH: 'v1/gateway/session' })).toThrow(
      /must start with/,
    );
  });

  it.each(['0', '-5', 'abc', '1.5'])('rejects a heartbeat interval of %p', (interval) => {
    expect(() =>
      loadGatewaySessionConfig({ GATEWAY_HEARTBEAT_INTERVAL_SECONDS: interval }),
    ).toThrow(/positive integer/);
  });

  it.each(['', '   '])('treats a blank path (%p) as unset', (path) => {
    expect(loadGatewaySessionConfig({ GATEWAY_WS_PATH: path }).path).toBe(DEFAULT_PATH);
  });
});

describe('GatewaySessionService', () => {
  const secrets = new GatewaySecretService();
  const CREDENTIAL = secrets.generate();

  const CLAIMED = {
    id: 'gw_1',
    serialNumber: 'VG100-0001',
    status: 'OFFLINE',
    propertyId: 'prop_1',
    roomId: 'room_1',
    credential: { id: 'cred_1', secretHash: CREDENTIAL.secretHash },
  };

  let findUnique: jest.Mock;
  /** `prisma.gateway.updateMany`: heartbeats and going offline. */
  let updateMany: jest.Mock;
  /** `tx.gateway.updateMany`: the guarded connect transition. */
  let transitionMany: jest.Mock;
  /** `tx.gateway.findUniqueOrThrow`: the session context, read after it. */
  let readBack: jest.Mock;
  let credentialUpdate: jest.Mock;
  let transaction: jest.Mock;
  let service: GatewaySessionService;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue(CLAIMED);
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    transitionMany = jest.fn().mockResolvedValue({ count: 1 });
    readBack = jest.fn().mockResolvedValue({
      serialNumber: CLAIMED.serialNumber,
      propertyId: CLAIMED.propertyId,
      roomId: CLAIMED.roomId,
    });
    credentialUpdate = jest.fn().mockResolvedValue({});

    // Runs the callback, so the guard inside the transaction is exercised
    // rather than stubbed past.
    transaction = jest.fn().mockImplementation((run: (tx: unknown) => unknown) =>
      run({
        gateway: { updateMany: transitionMany, findUniqueOrThrow: readBack },
        gatewayCredential: { update: credentialUpdate },
      }),
    );

    service = new GatewaySessionService(
      {
        gateway: { findUnique, updateMany },
        gatewayCredential: { update: credentialUpdate },
        $transaction: transaction,
      } as unknown as PrismaService,
      secrets,
    );
  });

  const PRESENTED = { serialNumber: 'VG100-0001', secret: CREDENTIAL.secret };

  describe('authenticate', () => {
    it('admits a claimed gateway presenting the right secret', async () => {
      await expect(service.authenticate(PRESENTED)).resolves.toEqual({
        gatewayId: 'gw_1',
        serialNumber: 'VG100-0001',
        propertyId: 'prop_1',
        roomId: 'room_1',
      });
    });

    it('marks the gateway online and its credential used, together', async () => {
      // One transaction: a gateway must not read as online without the
      // credential use being recorded alongside it.
      await service.authenticate(PRESENTED);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transitionMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ONLINE' }) }),
      );
      expect(credentialUpdate).toHaveBeenCalled();
    });

    /*
     * The checks read a row and the transition writes one, and an
     * administrator can disable a gateway in between. An unconditional write
     * would put DISABLED back to ONLINE, so taking hardware out of service
     * would fail against exactly the device that keeps reconnecting.
     */
    it('carries its conditions into the write rather than trusting the read', async () => {
      await service.authenticate(PRESENTED);

      expect(transitionMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'gw_1',
            status: { in: ['ONLINE', 'OFFLINE'] },
            // Pinned to the value that was read, not merely required to be
            // present, so the session returned cannot name a property the
            // gateway has since left.
            propertyId: 'prop_1',
          },
        }),
      );
    });

    it('refuses the session when the guarded transition matches nothing', async () => {
      transitionMany.mockResolvedValue({ count: 0 });

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
      // Nothing was written, including the credential use: a refused
      // connection must leave no trace of having nearly succeeded.
      expect(credentialUpdate).not.toHaveBeenCalled();
      expect(readBack).not.toHaveBeenCalled();
    });

    /*
     * A gateway's room is its voice context -- it is what turns "turn on the
     * light" into a specific device. A room read before the transition could
     * already be stale by the time the session exists, and the session would
     * go on sending commands to the wrong room for as long as it lasted.
     *
     * A reassignment is not a reason to refuse the connection; it is a reason
     * to use the new room. The update holds a lock on the row until commit,
     * so what is read here cannot change underneath it.
     */
    it('carries the room read after the transition, not the one read before it', async () => {
      readBack.mockResolvedValue({
        serialNumber: 'VG100-0001',
        propertyId: 'prop_1',
        roomId: 'room_moved',
      });

      await expect(service.authenticate(PRESENTED)).resolves.toEqual({
        gatewayId: 'gw_1',
        serialNumber: 'VG100-0001',
        propertyId: 'prop_1',
        roomId: 'room_moved',
      });
    });

    it('reads the room back only after the transition has succeeded', async () => {
      await service.authenticate(PRESENTED);

      const transitionOrder = transitionMany.mock.invocationCallOrder[0] ?? 0;
      const readOrder = readBack.mock.invocationCallOrder[0] ?? 0;
      expect(readOrder).toBeGreaterThan(transitionOrder);
    });

    it('carries a gateway with no room as having none', async () => {
      readBack.mockResolvedValue({
        serialNumber: 'VG100-0001',
        propertyId: 'prop_1',
        roomId: null,
      });

      await expect(service.authenticate(PRESENTED)).resolves.toMatchObject({ roomId: null });
    });

    it('refuses a gateway that lost its property inside the transaction', async () => {
      // Cannot happen while the guard holds, and refused rather than trusted
      // if it ever does: a session with no property has no room context.
      readBack.mockResolvedValue({
        serialNumber: 'VG100-0001',
        propertyId: null,
        roomId: null,
      });

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
    });

    it('rejects a wrong secret', async () => {
      await expect(
        service.authenticate({ ...PRESENTED, secret: 'not-the-secret' }),
      ).resolves.toBeNull();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects an unknown serial number', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
    });

    it('rejects a gateway with no credential issued', async () => {
      findUnique.mockResolvedValue({ ...CLAIMED, credential: null });

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
    });

    it('spends the hash even when the serial is unknown', async () => {
      // Otherwise an unregistered serial answers measurably faster than a
      // registered one with a wrong secret.
      const spy = jest.spyOn(secrets, 'hash');
      findUnique.mockResolvedValue(null);

      await service.authenticate(PRESENTED);

      expect(spy).toHaveBeenCalledWith(PRESENTED.secret);
      spy.mockRestore();
    });

    it('rejects an unclaimed gateway', async () => {
      // No property means no room context, and a manufactured-but-unsold unit
      // must not be able to open a session.
      findUnique.mockResolvedValue({
        ...CLAIMED,
        status: 'UNCLAIMED',
        propertyId: null,
        roomId: null,
      });

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
    });

    it('rejects a disabled gateway', async () => {
      findUnique.mockResolvedValue({ ...CLAIMED, status: 'DISABLED' });

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
    });

    it('rejects a gateway whose status is claimed but has no property', async () => {
      // The inconsistent state VG-005 refuses to create; refused here too.
      findUnique.mockResolvedValue({ ...CLAIMED, propertyId: null });

      await expect(service.authenticate(PRESENTED)).resolves.toBeNull();
    });

    it('checks the secret before the claim state', async () => {
      // A caller without a valid credential must learn nothing about whether
      // a gateway is claimed.
      findUnique.mockResolvedValue({ ...CLAIMED, status: 'UNCLAIMED', propertyId: null });

      await expect(service.authenticate({ ...PRESENTED, secret: 'wrong' })).resolves.toBeNull();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns no secret material', async () => {
      const session = await service.authenticate(PRESENTED);

      expect(JSON.stringify(session)).not.toMatch(/secret|sha256\$/i);
    });
  });

  describe('recordHeartbeat', () => {
    it('advances last seen', async () => {
      await expect(service.recordHeartbeat('gw_1')).resolves.toBe(true);

      const data = updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data.lastSeenAt).toBeInstanceOf(Date);
    });

    /*
     * The same race as the connect transition, arrived at from the other
     * side: a gateway disabled during a live session would otherwise put
     * itself back to ONLINE on its next heartbeat, undoing the change within
     * the heartbeat interval.
     */
    it('only applies to a gateway that is still online', async () => {
      await service.recordHeartbeat('gw_1');

      expect(updateMany.mock.calls[0]?.[0]?.where).toEqual({ id: 'gw_1', status: 'ONLINE' });
    });

    it('reports a gateway that no longer holds the standing it connected with', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await expect(service.recordHeartbeat('gw_1')).resolves.toBe(false);
    });

    it('does not write the status it is guarded on', async () => {
      // Writing ONLINE here would be the resurrection this guard exists to
      // prevent, reintroduced as a redundant assignment.
      await service.recordHeartbeat('gw_1');

      expect(updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('status');
    });

    it('records a reported firmware version', async () => {
      await service.recordHeartbeat('gw_1', '1.4.0');

      expect(updateMany.mock.calls[0]?.[0]?.data?.firmwareVersion).toBe('1.4.0');
    });

    it('leaves firmware alone when none is reported', async () => {
      await service.recordHeartbeat('gw_1');

      expect(updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('firmwareVersion');
    });

    it('never writes ownership from a heartbeat', async () => {
      // A device saying "I am still here" must not be able to move itself
      // between properties or rooms.
      await service.recordHeartbeat('gw_1', '1.4.0');

      const data = updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('propertyId');
      expect(data).not.toHaveProperty('roomId');
      expect(data).not.toHaveProperty('serialNumber');
    });
  });

  describe('markOffline', () => {
    it('takes an online gateway offline', async () => {
      await service.markOffline('gw_1');

      expect(updateMany.mock.calls[0]?.[0]?.data).toEqual({ status: 'OFFLINE' });
    });

    it('only applies to a gateway that is still online', async () => {
      // A gateway disabled while connected must stay disabled when its socket
      // drops; taking hardware out of service has to survive a disconnect.
      await service.markOffline('gw_1');

      expect(updateMany.mock.calls[0]?.[0]?.where).toEqual({ id: 'gw_1', status: 'ONLINE' });
    });
  });
});
