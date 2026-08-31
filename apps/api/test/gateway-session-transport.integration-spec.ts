import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WebSocket } from 'ws';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { GatewaySecretService } from '../src/gateways/gateway-secret.service';
import {
  CLOSE_PROTOCOL_ERROR,
  GATEWAY_AUTH_SCHEME,
} from '../src/gateways/session/gateway-session.protocol';
import { GatewaySessionServer } from '../src/gateways/session/gateway-session.server';
import { configureApp } from '../src/configure-app';

const secrets = new GatewaySecretService();
const CREDENTIAL = secrets.generate();

const GATEWAY = {
  id: 'gw_1',
  serialNumber: 'VG100-0001',
  status: 'OFFLINE',
  propertyId: 'prop_1',
  roomId: 'room_1',
  credential: { id: 'cred_1', secretHash: CREDENTIAL.secretHash },
};

/**
 * The session transport, end to end over a real socket, with the database
 * stubbed so it runs everywhere.
 *
 * The lifecycle against real rows — status transitions and their persistence —
 * is in gateway-session.integration-spec.ts, which needs PostgreSQL.
 */
describe('gateway session transport (integration)', () => {
  let app: INestApplication;
  let port: number;
  let findUnique: jest.Mock;
  let updateMany: jest.Mock;
  let transitionMany: jest.Mock;
  let readBack: jest.Mock;

  beforeAll(async () => {
    findUnique = jest.fn().mockResolvedValue(GATEWAY);
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    transitionMany = jest.fn().mockResolvedValue({ count: 1 });
    readBack = jest.fn().mockResolvedValue({
      serialNumber: GATEWAY.serialNumber,
      propertyId: GATEWAY.propertyId,
      roomId: GATEWAY.roomId,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        isReachable: jest.fn().mockResolvedValue(true),
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        // Runs the callback: the connect transition is guarded inside a
        // transaction, and a stub that skipped it would let a session exist
        // that the guard would have refused.
        $transaction: jest.fn().mockImplementation((run: (tx: unknown) => unknown) =>
          run({
            gateway: { updateMany: transitionMany, findUniqueOrThrow: readBack },
            gatewayCredential: { update: jest.fn().mockResolvedValue({}) },
          }),
        ),
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        gateway: { findUnique, updateMany },
        gatewayCredential: { update: jest.fn().mockResolvedValue({}) },
      })
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    findUnique.mockResolvedValue(GATEWAY);
    updateMany.mockClear().mockResolvedValue({ count: 1 });
    transitionMany.mockClear().mockResolvedValue({ count: 1 });
    readBack.mockClear().mockResolvedValue({
      serialNumber: GATEWAY.serialNumber,
      propertyId: GATEWAY.propertyId,
      roomId: GATEWAY.roomId,
    });
  });

  function connect(options: { authorization?: string; path?: string } = {}): WebSocket {
    const path = options.path ?? '/v1/gateway/session';
    const authorization =
      options.authorization ??
      `${GATEWAY_AUTH_SCHEME} ${GATEWAY.serialNumber}:${CREDENTIAL.secret}`;

    return new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, {
      headers: { authorization },
    });
  }

  /** Resolves with the first frame, or rejects if the socket fails to open. */
  function firstFrame(socket: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      socket.once('message', (data: Buffer) =>
        resolve(JSON.parse(data.toString('utf8')) as Record<string, unknown>),
      );
      socket.once('error', reject);
    });
  }

  /** Resolves with the close code, however the socket ends. */
  function closed(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => {
      socket.once('close', (code: number) => {
        resolve(code);
      });
      socket.once('error', () => undefined);
    });
  }

  /**
   * Waits for a condition the server settles asynchronously.
   *
   * The close handler writes the status after the socket has already reported
   * closed, so the assertion has to wait for the write rather than for the
   * frame.
   */
  async function eventually(condition: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(condition()).toBe(true);
  }

  describe('a device that authenticates', () => {
    it('is greeted with its identity and the heartbeat interval', async () => {
      const socket = connect();
      const ready = await firstFrame(socket);

      expect(ready).toMatchObject({ type: 'ready', gatewayId: 'gw_1', roomId: 'room_1' });
      expect(ready.heartbeatIntervalSeconds).toBeGreaterThan(0);

      socket.close();
      await closed(socket);
    });

    it('is acknowledged for a heartbeat', async () => {
      const socket = connect();
      await firstFrame(socket);

      const ack = firstFrame(socket);
      socket.send(JSON.stringify({ type: 'heartbeat' }));

      expect(await ack).toMatchObject({ type: 'heartbeat_ack' });

      socket.close();
      await closed(socket);
    });

    it('reports its firmware version through the heartbeat', async () => {
      const socket = connect();
      await firstFrame(socket);

      const ack = firstFrame(socket);
      socket.send(JSON.stringify({ type: 'heartbeat', firmwareVersion: '2.1.0' }));
      await ack;

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ firmwareVersion: '2.1.0' }),
        }),
      );

      socket.close();
      await closed(socket);
    });

    it('is never told anything about its own secret', async () => {
      const socket = connect();
      const ready = await firstFrame(socket);

      expect(JSON.stringify(ready)).not.toMatch(/secret|sha256\$/i);
      expect(JSON.stringify(ready)).not.toContain(CREDENTIAL.secret);

      socket.close();
      await closed(socket);
    });

    it('is counted as a live session while connected', async () => {
      const socket = connect();
      await firstFrame(socket);

      expect(app.get(GatewaySessionServer).activeConnectionCount).toBe(1);

      socket.close();
      await closed(socket);
    });
  });

  describe('a device that does not authenticate', () => {
    /** The handshake is refused, so `ws` reports an error, not a close code. */
    function refused(socket: WebSocket): Promise<Error> {
      return new Promise((resolve) => {
        socket.once('error', resolve);
        socket.once('open', () => {
          resolve(new Error('handshake unexpectedly succeeded'));
        });
      });
    }

    it.each([
      ['no authorization header', ''],
      ['a user bearer token', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc'],
      ['a malformed credential', `${GATEWAY_AUTH_SCHEME} no-separator`],
      ['an empty secret', `${GATEWAY_AUTH_SCHEME} VG100-0001:`],
      ['a wrong secret', `${GATEWAY_AUTH_SCHEME} VG100-0001:not-the-secret`],
    ])('is refused at the handshake with %s', async (_label, authorization) => {
      // Refused during the upgrade, so an unauthenticated peer never holds a
      // WebSocket at all.
      const error = await refused(connect({ authorization }));

      expect(error.message).toMatch(/401|unexpected server response/i);
    });

    it('is refused when the serial is unknown', async () => {
      findUnique.mockResolvedValue(null);

      const error = await refused(connect());

      expect(error.message).toMatch(/401|unexpected server response/i);
    });

    it.each([
      ['unclaimed', { status: 'UNCLAIMED', propertyId: null, roomId: null }],
      ['disabled', { status: 'DISABLED' }],
      ['claimed but without a property', { propertyId: null }],
    ])('is refused when the gateway is %s', async (_label, overrides) => {
      findUnique.mockResolvedValue({ ...GATEWAY, ...overrides });

      const error = await refused(connect());

      expect(error.message).toMatch(/401|unexpected server response/i);
    });

    it('is refused identically whatever the reason', async () => {
      // An unknown serial, a wrong secret, and an unclaimed gateway must look
      // the same, or the socket becomes a serial-number oracle.
      const wrongSecret = await refused(
        connect({ authorization: `${GATEWAY_AUTH_SCHEME} VG100-0001:wrong` }),
      );

      findUnique.mockResolvedValue(null);
      const unknownSerial = await refused(connect());

      findUnique.mockResolvedValue({ ...GATEWAY, status: 'UNCLAIMED', propertyId: null });
      const unclaimed = await refused(connect());

      expect(new Set([wrongSecret.message, unknownSerial.message, unclaimed.message]).size).toBe(1);
    });

    it('never reaches the database without a parseable credential', async () => {
      findUnique.mockClear();

      await refused(connect({ authorization: 'Bearer some-user-token' }));

      expect(findUnique).not.toHaveBeenCalled();
    });

    it('does not mark anything online', async () => {
      transitionMany.mockClear();
      findUnique.mockResolvedValue(null);

      await refused(connect());

      expect(transitionMany).not.toHaveBeenCalled();
    });
  });

  describe('protocol errors', () => {
    it.each([
      ['a non-JSON frame', 'not json'],
      ['an unknown message type', '{"type":"shutdown"}'],
      ['a JSON array', '[]'],
      ['an empty frame', ''],
    ])('closes the socket on %s', async (_label, frame) => {
      // The two ends are one implementation each; an unparseable frame means
      // they are out of step, and carrying on would hide that.
      const socket = connect();
      await firstFrame(socket);

      const ending = closed(socket);
      socket.send(frame);

      expect(await ending).toBe(CLOSE_PROTOCOL_ERROR);
    });

    it('closes the socket on a binary frame', async () => {
      // Audio has its own task; this socket carries text.
      const socket = connect();
      await firstFrame(socket);

      const ending = closed(socket);
      socket.send(Buffer.from([0x01, 0x02, 0x03]));

      expect(await ending).toBe(CLOSE_PROTOCOL_ERROR);
    });
  });

  describe('path routing', () => {
    it('does not upgrade on a path it does not own', async () => {
      const socket = connect({ path: '/v1/not-the-session' });

      await expect(
        new Promise((resolve, reject) => {
          socket.once('error', reject);
          socket.once('open', resolve);
        }),
      ).rejects.toThrow();
    });

    it('leaves the HTTP API reachable on the same server', async () => {
      // The upgrade handler must not interfere with ordinary requests.
      const response = await fetch(`http://127.0.0.1:${String(port)}/v1/health`);

      expect(response.status).toBe(200);
    });
  });

  describe('session lifecycle', () => {
    it('marks the gateway offline when the socket closes', async () => {
      const socket = connect();
      await firstFrame(socket);
      updateMany.mockClear();

      socket.close();
      await closed(socket);
      await eventually(() => updateMany.mock.calls.length > 0);

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'OFFLINE' } }),
      );
    });

    it('supersedes an earlier connection when a gateway reconnects', async () => {
      // A device recovering from a half-open TCP connection reconnects while
      // the server still believes the old socket is live.
      const first = connect();
      await firstFrame(first);

      const second = connect();
      await firstFrame(second);

      expect(app.get(GatewaySessionServer).activeConnectionCount).toBe(1);

      second.close();
      await closed(second);
    });

    it('does not mark the gateway offline when a superseded socket closes', async () => {
      // The old socket's close arrives after the new one is established. If
      // it settled the status, a reconnected gateway would read OFFLINE.
      const first = connect();
      await firstFrame(first);
      const second = connect();
      await firstFrame(second);

      await closed(first);
      updateMany.mockClear();
      // Give the superseded socket's close handler every chance to run.
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(updateMany).not.toHaveBeenCalled();

      second.close();
      await closed(second);
    });
  });
});
