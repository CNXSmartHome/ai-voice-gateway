import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ServiceRequestSource,
  ServiceRequestStatus,
} from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PrismaService } from '../database/prisma.service';
import type { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { assertServiceRequestTransition } from './service-request.state';

const SERVICE_REQUEST_INCLUDE = {
  room: { select: { id: true, name: true } },
  items: { select: { id: true, sku: true, name: true, quantity: true } },
  events: {
    select: { id: true, fromStatus: true, toStatus: true, actorUserId: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestView = Prisma.ServiceRequestGetPayload<{
  include: typeof SERVICE_REQUEST_INCLUDE;
}>;

@Injectable()
export class ServiceRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    caller: AuthenticatedUser,
    propertyId: string,
    input: CreateServiceRequestDto,
    idempotencyKey?: string,
  ): Promise<ServiceRequestView> {
    await this.assertPropertyVisible(caller, propertyId);
    if (input.roomId !== undefined) await this.assertRoomInProperty(input.roomId, propertyId);

    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    if (normalizedKey !== undefined) {
      const existing = await this.prisma.serviceRequest.findFirst({
        where: { propertyId, idempotencyKey: normalizedKey },
        include: SERVICE_REQUEST_INCLUDE,
      });
      if (existing !== null) return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        return tx.serviceRequest.create({
          data: {
            publicId: makePublicId(),
            propertyId,
            roomId: input.roomId,
            createdByUserId: caller.id,
            source: ServiceRequestSource.ADMIN,
            category: input.category.trim(),
            note: input.note?.trim() || null,
            idempotencyKey: normalizedKey,
            items: {
              create: input.items.map((item) => ({
                sku: item.sku.trim(),
                name: item.name?.trim() || null,
                quantity: item.quantity,
              })),
            },
            events: {
              create: {
                fromStatus: null,
                toStatus: ServiceRequestStatus.NEW,
                actorUserId: caller.id,
              },
            },
          },
          include: SERVICE_REQUEST_INCLUDE,
        });
      });
    } catch (error) {
      if (normalizedKey !== undefined && isUniqueViolation(error)) {
        const existing = await this.prisma.serviceRequest.findFirst({
          where: { propertyId, idempotencyKey: normalizedKey },
          include: SERVICE_REQUEST_INCLUDE,
        });
        if (existing !== null) return existing;
      }
      throw error;
    }
  }

  async list(caller: AuthenticatedUser, propertyId: string): Promise<ServiceRequestView[]> {
    await this.assertPropertyVisible(caller, propertyId);
    return this.prisma.serviceRequest.findMany({
      where: { propertyId },
      include: SERVICE_REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(
    caller: AuthenticatedUser,
    propertyId: string,
    requestId: string,
  ): Promise<ServiceRequestView> {
    await this.assertPropertyVisible(caller, propertyId);
    const request = await this.prisma.serviceRequest.findFirst({
      where: { propertyId, OR: [{ id: requestId }, { publicId: requestId }] },
      include: SERVICE_REQUEST_INCLUDE,
    });
    if (request === null) throw serviceRequestNotFound();
    return request;
  }

  async transition(
    caller: AuthenticatedUser,
    propertyId: string,
    requestId: string,
    toStatus: ServiceRequestStatus,
  ): Promise<ServiceRequestView> {
    await this.assertPropertyVisible(caller, propertyId);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceRequest.findFirst({
        where: { propertyId, OR: [{ id: requestId }, { publicId: requestId }] },
        select: { id: true, status: true },
      });
      if (current === null) throw serviceRequestNotFound();

      assertServiceRequestTransition(current.status, toStatus);

      const updated = await tx.serviceRequest.updateMany({
        where: { id: current.id, propertyId, status: current.status },
        data: {
          status: toStatus,
          completedAt: toStatus === ServiceRequestStatus.COMPLETED ? new Date() : null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Service request changed concurrently; reload and retry.');
      }

      await tx.serviceRequestEvent.create({
        data: {
          requestId: current.id,
          fromStatus: current.status,
          toStatus,
          actorUserId: caller.id,
        },
      });

      return tx.serviceRequest.findUniqueOrThrow({
        where: { id: current.id },
        include: SERVICE_REQUEST_INCLUDE,
      });
    });
  }

  private async assertPropertyVisible(caller: AuthenticatedUser, propertyId: string): Promise<void> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { organizationId: true },
    });
    if (
      property === null ||
      !caller.memberships.some((membership) => membership.organizationId === property.organizationId)
    ) {
      throw new NotFoundException('Property not found.');
    }
  }

  private async assertRoomInProperty(roomId: string, propertyId: string): Promise<void> {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true },
    });
    if (room === null) throw new NotFoundException('Room not found in property.');
  }
}

function makePublicId(): string {
  return `REQ-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeIdempotencyKey(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 200) throw new ConflictException('Idempotency-Key is too long.');
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function serviceRequestNotFound(): NotFoundException {
  return new NotFoundException('Service request not found.');
}
