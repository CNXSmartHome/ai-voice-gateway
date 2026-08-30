import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client bound to the Nest lifecycle.
 *
 * Connects on module init so a bad `DATABASE_URL` fails at startup rather
 * than on the first request, and disconnects on shutdown so the pool is
 * released cleanly between tests and on redeploy.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Reports whether the database answers a trivial query.
   *
   * Deliberately returns a boolean rather than propagating the driver error:
   * the readiness endpoint is unauthenticated, and driver errors carry the
   * host and connection string.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
}
