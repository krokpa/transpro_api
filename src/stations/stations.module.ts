import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';

@Module({
  imports: [PrismaModule, ReportsModule],
  providers: [StationsService],
  controllers: [StationsController],
  exports: [StationsService],
})
export class StationsModule {}
