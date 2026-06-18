import { Module } from '@nestjs/common';
import { StationCashPeriodsService } from './station-cash-periods.service';
import { StationCashPeriodsController } from './station-cash-periods.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [StationCashPeriodsService],
  controllers: [StationCashPeriodsController],
  exports: [StationCashPeriodsService],
})
export class StationCashPeriodsModule {}
