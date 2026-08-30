import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { WebSocket, WebSocketServer } from 'ws';

import { GATEWAY_SESSION_CONFIG } from '../gateways.constants';

import type { GatewaySessionConfig } from './gateway-session.config';
import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_PROTOCOL_ERROR_REASON,
  CLOSE_TIMEOUT,
  CLOSE_TIMEOUT_REASON,
  CLOSE_UNAUTHORIZED,
  CLOSE_UNAUTHORIZED_REASON,
  MAX_FRAME_BYTES,
  parseAuthorization,
  parseInboundMessage,
  serializeOutbound,
} from './gateway-session.protocol';
import { GatewaySessionService, type GatewaySession } from './gateway-session.service';

/** A live connection and the gateway behind it. */
interface Connection {
  readonly socket: WebSocket;
  readonly session: GatewaySession;
  /** Cleared when the peer answers a ping; a missed answer closes the socket. */
  awaitingPong: boolean;
}

/**
 * The gateway session transport (VG-006).
 *
 * Built on `ws` with `noServer: true` rather than Nest's WebSocket adapter,
 * for one reason that matters: authentication happens during the HTTP
 * upgrade. An unauthenticated device never becomes a WebSocket at all — the
 * handshake is refused — instead of being accepted and then closed, which
 * would give an unauthenticated peer a live socket for however long that
 * takes.
 *
 * Connection state lives in this process. A multi-instance deployment needs
 * shared state to know a gateway is online elsewhere; no MVP task has
 * required that yet, and it is recorded as a limitation rather than guessed
 * at here.
 */
@Injectable()
export class GatewaySessionServer implements OnApplicationShutdown {
  private readonly logger = new Logger(GatewaySessionServer.name);
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  /** Current connection per gateway, so a reconnect supersedes cleanly. */
  private readonly connections = new Map<string, Connection>();
  private liveness: NodeJS.Timeout | undefined;
  private upgradeHandler:
    ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;
  private attachedTo: HttpServer | undefined;

  constructor(
    private readonly sessions: GatewaySessionService,
    @Inject(GATEWAY_SESSION_CONFIG) private readonly config: GatewaySessionConfig,
  ) {}

  /**
   * Attaches to the HTTP server's upgrade event.
   *
   * Called explicitly from `configureApp` rather than from a lifecycle hook,
   * so the same wiring runs in production and in tests — the pattern VG-002
   * established for the global pipe, after configuring the two separately let
   * a startup failure pass the suite.
   */
  attach(httpServer: HttpServer): void {
    if (this.attachedTo === httpServer) return;

    this.upgradeHandler = (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    };
    httpServer.on('upgrade', this.upgradeHandler);
    this.attachedTo = httpServer;

    this.liveness = setInterval(() => {
      this.sweep();
    }, this.config.heartbeatIntervalSeconds * 1000);
    // Do not hold the process open for liveness checks alone.
    this.liveness.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.liveness !== undefined) clearInterval(this.liveness);
    if (this.attachedTo !== undefined && this.upgradeHandler !== undefined) {
      this.attachedTo.off('upgrade', this.upgradeHandler);
      this.attachedTo = undefined;
    }

    const closing = [...this.connections.values()].map(async (connection) => {
      connection.socket.terminate();
      await this.sessions.markOffline(connection.session.gatewayId).catch(() => undefined);
    });
    this.connections.clear();
    await Promise.all(closing);

    this.server.close();
  }

  /** Visible for tests: how many sessions this process is holding. */
  get activeConnectionCount(): number {
    return this.connections.size;
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // Node does not close an upgrade socket that no listener answers, so
    // returning early would leave the peer waiting forever -- and would hold
    // the HTTP server open on shutdown, since it waits for its connections.
    // This application has exactly one upgrade handler; adding a second would
    // need the two to arbitrate rather than each refusing what it does not
    // recognise.
    if (!this.matchesPath(request.url)) {
      rejectUpgrade(socket, 404);
      return;
    }

    const presented = parseAuthorization(request.headers.authorization);
    if (presented === null) {
      rejectUpgrade(socket);
      return;
    }

    let session: GatewaySession | null;
    try {
      session = await this.sessions.authenticate(presented);
    } catch (error) {
      // A database failure must not leak through the handshake. It is logged
      // for us and refused for the caller, like any other failure.
      this.logger.error('Gateway authentication failed', error instanceof Error ? error.stack : '');
      rejectUpgrade(socket, 503);
      return;
    }

    if (session === null) {
      rejectUpgrade(socket);
      return;
    }

    this.server.handleUpgrade(request, socket, head, (client) => {
      this.register(client, session);
    });
  }

  private matchesPath(url: string | undefined): boolean {
    if (url === undefined) return false;

    // Compare the path alone: a query string must not change which handler
    // claims the upgrade.
    const path = url.split('?')[0] ?? '';
    return path === this.config.path;
  }

  private register(socket: WebSocket, session: GatewaySession): void {
    // A gateway holds one session. A second connection supersedes the first,
    // which is what a device reconnecting after a half-open TCP connection
    // looks like from here.
    const existing = this.connections.get(session.gatewayId);
    if (existing !== undefined) {
      this.connections.delete(session.gatewayId);
      existing.socket.terminate();
    }

    const connection: Connection = { socket, session, awaitingPong: false };
    this.connections.set(session.gatewayId, connection);

    socket.on('pong', () => {
      connection.awaitingPong = false;
    });

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      void this.handleMessage(connection, data, isBinary);
    });

    socket.on('close', () => {
      void this.handleClose(connection);
    });

    socket.on('error', () => {
      // `close` always follows, which is where the status is settled.
      socket.terminate();
    });

    socket.send(
      serializeOutbound({
        type: 'ready',
        gatewayId: session.gatewayId,
        roomId: session.roomId,
        heartbeatIntervalSeconds: this.config.heartbeatIntervalSeconds,
      }),
    );
  }

  private async handleMessage(
    connection: Connection,
    data: Buffer,
    isBinary: boolean,
  ): Promise<void> {
    // Audio arrives on its own task (VG-018); this socket carries text.
    const message = isBinary ? null : parseInboundMessage(data);
    if (message === null) {
      connection.socket.close(CLOSE_PROTOCOL_ERROR, CLOSE_PROTOCOL_ERROR_REASON);
      return;
    }

    connection.awaitingPong = false;

    try {
      await this.sessions.recordHeartbeat(connection.session.gatewayId, message.firmwareVersion);
    } catch (error) {
      this.logger.error('Heartbeat failed', error instanceof Error ? error.stack : '');
      return;
    }

    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(
        serializeOutbound({ type: 'heartbeat_ack', serverTime: new Date().toISOString() }),
      );
    }
  }

  private async handleClose(connection: Connection): Promise<void> {
    // Only settle the status if this socket is still the current one. A
    // superseded connection closing must not mark a reconnected gateway
    // offline.
    if (this.connections.get(connection.session.gatewayId) !== connection) return;

    this.connections.delete(connection.session.gatewayId);
    await this.sessions.markOffline(connection.session.gatewayId).catch((error: unknown) => {
      this.logger.error(
        'Failed to mark gateway offline',
        error instanceof Error ? error.stack : '',
      );
    });
  }

  /**
   * Drops connections that stopped answering.
   *
   * A device that loses power or network never sends a close frame, so
   * without this the gateway would read `ONLINE` indefinitely — worse than
   * useless, because the app would show it as reachable.
   */
  private sweep(): void {
    for (const connection of this.connections.values()) {
      if (connection.awaitingPong) {
        connection.socket.close(CLOSE_TIMEOUT, CLOSE_TIMEOUT_REASON);
        continue;
      }

      connection.awaitingPong = true;
      connection.socket.ping();
    }
  }
}

const REASONS: Record<number, string> = {
  401: 'Unauthorized',
  404: 'Not Found',
  503: 'Service Unavailable',
};

/**
 * Refuses the handshake.
 *
 * The same response for every authentication failure: an unknown serial, a
 * wrong secret, an unclaimed gateway, and a disabled one are indistinguishable
 * to whoever is connecting.
 */
function rejectUpgrade(socket: Duplex, status = 401): void {
  const reason = REASONS[status] ?? 'Unauthorized';
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export { CLOSE_UNAUTHORIZED, CLOSE_UNAUTHORIZED_REASON };
