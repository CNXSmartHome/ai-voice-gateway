import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';

import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertiesService } from './properties.service';
import type { PropertyView } from './property.view';

/**
 * Properties: the places a system covers.
 *
 * `POST /v1/gateways/claim` (VG-005) has required a `propertyId` since it was
 * written, and nothing could produce one — the schema has had `Property`
 * since VG-003, but no HTTP surface. This is that surface, and it is what
 * makes the Day 7 milestone in `docs/30_DAY_PLAN.md` reachable from an app.
 *
 * No `@Public()` anywhere: the global guard from VG-004 applies.
 */
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Post()
  async create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() body: CreatePropertyDto,
  ): Promise<PropertyView> {
    return this.properties.create(caller, body);
  }

  @Get()
  async list(@CurrentUser() caller: AuthenticatedUser): Promise<PropertyView[]> {
    return this.properties.list(caller);
  }

  @Get(':id')
  async get(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PropertyView> {
    return this.properties.get(caller, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdatePropertyDto,
  ): Promise<PropertyView> {
    return this.properties.update(caller, id, body);
  }
}
