import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';

import { ClaimGatewayDto } from './dto/claim-gateway.dto';
import type { GatewayView } from './gateway.view';
import { GatewaysService } from './gateways.service';

/**
 * Gateway claim (VG-005).
 *
 * No `@Public()` anywhere: the global guard from VG-004 applies, so every
 * route here requires an authenticated caller.
 */
@Controller('gateways')
export class GatewaysController {
  constructor(private readonly gateways: GatewaysService) {}

  /**
   * Claims a manufactured gateway into a property.
   *
   * 200 rather than 201: the gateway row already existed. The claim binds it
   * to a property, it does not bring it into being.
   */
  @HttpCode(HttpStatus.OK)
  @Post('claim')
  async claim(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() body: ClaimGatewayDto,
  ): Promise<GatewayView> {
    return this.gateways.claim(caller, body);
  }
}
