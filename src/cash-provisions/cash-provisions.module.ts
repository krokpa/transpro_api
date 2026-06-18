import { Module } from '@nestjs/common';
import { CashProvisionsService } from './cash-provisions.service';
import { CashProvisionsController } from './cash-provisions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StationCashPeriodsModule } from '../station-cash-periods/station-cash-periods.module';

@Module({
  imports: [PrismaModule, StationCashPeriodsModule],
  providers: [CashProvisionsService],
  controllers: [CashProvisionsController],
  exports: [CashProvisionsService],
})
export class CashProvisionsModule {}
