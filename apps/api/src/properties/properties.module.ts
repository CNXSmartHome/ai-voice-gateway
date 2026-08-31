import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

/**
 * Properties, the missing link between an account and its hardware.
 *
 * Rooms belong with room assignment (VG-013); this module stops at the
 * property so that a gateway can be claimed into one.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
