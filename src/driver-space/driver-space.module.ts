import { Module } from '@nestjs/common';
import { DriverSpaceService } from './driver-space.service';
import { DriverSpaceController } from './driver-space.controller';

@Module({
  controllers: [DriverSpaceController],
  providers: [DriverSpaceService],
})
export class DriverSpaceModule {}
