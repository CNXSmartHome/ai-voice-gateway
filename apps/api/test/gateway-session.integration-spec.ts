import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WebSocket } from 'ws';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { GatewaysService } from '../src/gateways/gateways.service';
import { GATEWAY_AUTH_SCHEME } from '../src/gateways/session/gateway-session.protocol';
import { configureApp } from '../src/configure-app';

/**
 * The session lifecycle against real rows: what a connect, a heartbeat, and a
 * disconnect actually persist.
 *
 * Requires DATABASE_URL. CI provides a PostgreSQL service container; see
 * `docs/CI.md`. Without it the suite is skipped rather than failing, so a
 * developer with no local database still gets a green unit run.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeWithDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console -- visibility matters more than lint here
  console.warn(
    '\n  DATABASE_URL is not set: skipping gateway session integration tests.' +
      '\n  These run in CI against a PostgreSQL service container.\n',
  );
}

describeWithDb('gateway session lifecycle (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateways: GatewaysService;
  let port: number;

  const createdGatewayIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  let sequence = 0;

  function unique(label: string): string {
    sequence += 1;
    return `${label}-${String(Date.now())}-${String(sequence)}`;
  }

  /** A registered, claimed gateway with a room, and its device secret. */
  async function claimedGateway(label: string) {
    const organization = await prisma.organization.create({
      data: { name: `Org ${unique(label)}` },
    });
    createdOrganizationIds.push(organization.id);

    const property = await prisma.property.create({
      data: { organizationId: organization.id, name: `Villa ${unique(label)}` },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: `Room ${unique(label)}` },
    });

    const { gateway, secret } = await gateways.register({
      serialNumber: `VG100-${unique(label)}`.slice(0, 64),
    });
    createdGatewayIds.push(gateway.id);

    await prisma.gateway.update({
      where: { id: gateway.id },
      data: { propertyId: property.id, roomId: room.id, status: 'OFFLINE' },
    });

    return { gateway, secret, property, room };
  }

  function connect(serialNumber: string, secret: string): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${String(port)}/v1/gateway/session`, {
      headers: { authorization: `${GATEWAY_AUTH_SCHEME} ${serialNumber}:${secret}` },
    });
  }

  function opened(socket: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      socket.once('message', (data: Buffer) =>
        resolve(JSON.parse(data.toString('utf8')) as Record<string, unknown>),
      );
      socket.once('error', reject);
    });
  }

  function refused(socket: WebSocket): Promise<Error> {
    return new Promise((resolve) => {
      socket.once('error', resolve);
      socket.once('open', () => resolve(new Error('handshake unexpectedly succeeded')));
    });
  }

  function closed(socket: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      socket.once('close', () => resolve());
      socket.once('error', () => resolve());
    });
  }

  /** Polls until the server has persisted what the socket only signalled. */
  async function eventually(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await check()) return;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await check()).toBe(true);
  }

  async function statusOf(gatewayId: string): Promise<string> {
    const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gatewayId } });
    return row.status;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    prisma = app.get(PrismaService);
    gateways = app.get(GatewaysService);
  });

  afterAll(async () => {
    await prisma.gateway.deleteMany({ where: { id: { in: createdGatewayIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
    await app.close();
  });

  describe('registration issues a usable credential', () => {
    it('stores only a hash of the secret', async () => {
      const { gateway, secret } = await claimedGateway('hashing');

      const credential = await prisma.gatewayCredential.findUniqueOrThrow({
        where: { gatewayId: gateway.id },
      });

      expect(credential.secretHash).not.toContain(secret);
      expect(credential.secretHash).toMatch(/^sha256\$v=1\$/);
    });

    it('creates the gateway and its credential together', async () => {
      // A gateway without a credential could never connect; the two are
      // written in one create so that state cannot exist.
      const { gateway } = await claimedGateway('paired');

      await expect(
        prisma.gatewayCredential.count({ where: { gatewayId: gateway.id } }),
      ).resolves.toBe(1);
    });
  });

  describe('connecting', () => {
    it('brings a claimed gateway online and records it was seen', async () => {
      const { gateway, secret } = await claimedGateway('online');
      expect(await statusOf(gateway.id)).toBe('OFFLINE');

      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);

      await eventually(async () => (await statusOf(gateway.id)) === 'ONLINE');
      const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });
      expect(row.lastSeenAt).not.toBeNull();

      socket.close();
      await closed(socket);
    });

    it('records that the credential was used', async () => {
      const { gateway, secret } = await claimedGateway('cred-used');

      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);

      await eventually(async () => {
        const credential = await prisma.gatewayCredential.findUniqueOrThrow({
          where: { gatewayId: gateway.id },
        });
        return credential.lastUsedAt !== null;
      });

      socket.close();
      await closed(socket);
    });

    it('tells the gateway which room it is in', async () => {
      // The room is the voice context: it is what resolves "turn on the
      // light" to a device (VG-021).
      const { gateway, secret, room } = await claimedGateway('room');

      const socket = connect(gateway.serialNumber, secret);
      const ready = await opened(socket);

      expect(ready).toMatchObject({ type: 'ready', gatewayId: gateway.id, roomId: room.id });

      socket.close();
      await closed(socket);
    });

    it('refuses a wrong secret and leaves the gateway offline', async () => {
      const { gateway } = await claimedGateway('wrong-secret');

      await refused(connect(gateway.serialNumber, 'not-the-secret'));

      expect(await statusOf(gateway.id)).toBe('OFFLINE');
    });

    it('refuses an unknown serial number', async () => {
      const { secret } = await claimedGateway('unknown-serial');

      const error = await refused(connect('VG100-not-registered', secret));

      expect(error.message).toMatch(/401|unexpected server response/i);
    });

    it('refuses one gateway using another gateway secret', async () => {
      const target = await claimedGateway('cross-a');
      const other = await claimedGateway('cross-b');

      await refused(connect(target.gateway.serialNumber, other.secret));

      expect(await statusOf(target.gateway.id)).toBe('OFFLINE');
    });

    it('refuses an unclaimed gateway', async () => {
      // No property means no room context, and a manufactured-but-unsold unit
      // must not be able to open a session.
      const { gateway, secret } = await gateways
        .register({ serialNumber: `VG100-${unique('unclaimed')}`.slice(0, 64) })
        .then((result) => {
          createdGatewayIds.push(result.gateway.id);
          return result;
        });

      await refused(connect(gateway.serialNumber, secret));

      expect(await statusOf(gateway.id)).toBe('UNCLAIMED');
    });

    it('refuses a disabled gateway and leaves it disabled', async () => {
      const { gateway, secret } = await claimedGateway('disabled');
      await prisma.gateway.update({ where: { id: gateway.id }, data: { status: 'DISABLED' } });

      await refused(connect(gateway.serialNumber, secret));

      expect(await statusOf(gateway.id)).toBe('DISABLED');
    });

    /*
     * Authentication reads the gateway, then writes it online. An
     * administrator disabling it in between must win, or taking a gateway out
     * of service silently fails against exactly the device that keeps
     * reconnecting.
     *
     * The window is opened deliberately rather than raced for: the write
     * happens inside the service's transaction, so intercepting the first
     * transaction and disabling the row immediately before it runs puts the
     * change precisely where a real administrator's would have to land.
     */
    it('refuses a connect when the gateway is disabled between the read and the write', async () => {
      const { gateway, secret } = await claimedGateway('connect-race');

      const runTransaction = prisma.$transaction.bind(prisma) as (argument: unknown) => unknown;
      const intercept = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (argument: unknown) => {
          intercept.mockRestore();
          await prisma.gateway.update({
            where: { id: gateway.id },
            data: { status: 'DISABLED' },
          });
          return runTransaction(argument);
        }) as unknown as jest.SpyInstance;

      const socket = connect(gateway.serialNumber, secret);
      let handshakeSucceeded = false;
      socket.once('open', () => {
        handshakeSucceeded = true;
      });

      try {
        await refused(socket);
      } finally {
        intercept.mockRestore();
        if (handshakeSucceeded) {
          // Only reachable if the guard regressed. Closed properly anyway, so
          // the failure is an assertion rather than a suite that hangs on a
          // socket holding the server open in afterAll.
          socket.close();
          await closed(socket);
        } else {
          // A refused handshake has already emitted its error and may have
          // emitted its close; waiting for another event would wait forever.
          socket.terminate();
        }
      }

      expect(handshakeSucceeded).toBe(false);

      // The guarded transition matched nothing, so nothing was written.
      expect(await statusOf(gateway.id)).toBe('DISABLED');
      const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });
      expect(row.lastSeenAt).toBeNull();
    });
  });

  describe('heartbeats', () => {
    it('advances last seen without touching ownership', async () => {
      const { gateway, secret, property, room } = await claimedGateway('heartbeat');
      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);

      await eventually(async () => (await statusOf(gateway.id)) === 'ONLINE');
      const before = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });

      await new Promise((resolve) => setTimeout(resolve, 50));
      socket.send(JSON.stringify({ type: 'heartbeat' }));

      await eventually(async () => {
        const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });
        return (row.lastSeenAt?.getTime() ?? 0) > (before.lastSeenAt?.getTime() ?? 0);
      });

      // A device saying "I am still here" must not move itself anywhere.
      const after = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });
      expect(after.propertyId).toBe(property.id);
      expect(after.roomId).toBe(room.id);
      expect(after.serialNumber).toBe(gateway.serialNumber);

      socket.close();
      await closed(socket);
    });

    /*
     * The same race, arrived at from the other side. A gateway disabled while
     * its session is open would, with an unguarded heartbeat, put itself back
     * to ONLINE within the heartbeat interval -- undoing the change faster
     * than anyone could see it had not taken.
     */
    it('closes the session and stays disabled when the gateway is disabled mid-session', async () => {
      const { gateway, secret } = await claimedGateway('heartbeat-disabled');
      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);
      await eventually(async () => (await statusOf(gateway.id)) === 'ONLINE');

      await prisma.gateway.update({ where: { id: gateway.id }, data: { status: 'DISABLED' } });
      socket.send(JSON.stringify({ type: 'heartbeat' }));

      await closed(socket);

      expect(await statusOf(gateway.id)).toBe('DISABLED');
    });

    it('records the firmware version the gateway reports', async () => {
      const { gateway, secret } = await claimedGateway('firmware');
      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);

      socket.send(JSON.stringify({ type: 'heartbeat', firmwareVersion: '3.2.1' }));

      await eventually(async () => {
        const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gateway.id } });
        return row.firmwareVersion === '3.2.1';
      });

      socket.close();
      await closed(socket);
    });
  });

  describe('disconnecting', () => {
    it('marks the gateway offline', async () => {
      const { gateway, secret } = await claimedGateway('disconnect');
      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);
      await eventually(async () => (await statusOf(gateway.id)) === 'ONLINE');

      socket.close();
      await closed(socket);

      await eventually(async () => (await statusOf(gateway.id)) === 'OFFLINE');
    });

    it('leaves a gateway disabled mid-session disabled', async () => {
      // Taking hardware out of service has to survive it dropping its socket.
      const { gateway, secret } = await claimedGateway('disabled-midway');
      const socket = connect(gateway.serialNumber, secret);
      await opened(socket);
      await eventually(async () => (await statusOf(gateway.id)) === 'ONLINE');

      await prisma.gateway.update({ where: { id: gateway.id }, data: { status: 'DISABLED' } });
      socket.close();
      await closed(socket);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await statusOf(gateway.id)).toBe('DISABLED');
    });

    it('comes back online on reconnect', async () => {
      const { gateway, secret } = await claimedGateway('reconnect');

      const first = connect(gateway.serialNumber, secret);
      await opened(first);
      first.close();
      await closed(first);
      await eventually(async () => (await statusOf(gateway.id)) === 'OFFLINE');

      const second = connect(gateway.serialNumber, secret);
      await opened(second);
      await eventually(async () => (await statusOf(gateway.id)) === 'ONLINE');

      second.close();
      await closed(second);
    });

    it('stays online when a superseded connection closes', async () => {
      // A device recovering from a half-open TCP connection reconnects while
      // the server still believes the old socket is live. The old close must
      // not mark the reconnected gateway offline.
      const { gateway, secret } = await claimedGateway('supersede');

      const first = connect(gateway.serialNumber, secret);
      await opened(first);
      const second = connect(gateway.serialNumber, secret);
      await opened(second);

      await closed(first);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(await statusOf(gateway.id)).toBe('ONLINE');

      second.close();
      await closed(second);
    });
  });

  describe('the HTTP API is unaffected', () => {
    it('still serves readiness on the same server', async () => {
      const response = await fetch(`http://127.0.0.1:${String(port)}/v1/health/ready`);

      expect(response.status).toBe(200);
    });
  });
});
