import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { TransitionServiceRequestDto } from './dto/transition-service-request.dto';
import {
  ServiceRequestsService,
  type ServiceRequestView,
} from './service-requests.service';

/**
 * Authenticated operator surface for the Smart Villa service-request core.
 * Guest and SVC-Voice entry points are separate tasks and will call the same
 * ServiceRequestsService instead of duplicating workflow logic.
 */
@Controller('properties/:propertyId/service-requests')
export class ServiceRequestsController {
  constructor(private readonly serviceRequests: ServiceRequestsService) {}

  @Post()
  create(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateServiceRequestDto,
  ): Promise<ServiceRequestView> {
    return this.serviceRequests.create(caller, propertyId, body, idempotencyKey);
  }

  @Get()
  list(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ServiceRequestView[]> {
    return this.serviceRequests.list(caller, propertyId);
  }

  @Get(':requestId')
  get(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
  ): Promise<ServiceRequestView> {
    return this.serviceRequests.get(caller, propertyId, requestId);
  }

  @Patch(':requestId/status')
  transition(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
    @Body() body: TransitionServiceRequestDto,
  ): Promise<ServiceRequestView> {
    return this.serviceRequests.transition(caller, propertyId, requestId, body.status);
  }
}
