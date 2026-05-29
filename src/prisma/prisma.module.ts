import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PlanLimitsService } from '../common/plan-limits.service';

@Global()
@Module({
  providers: [PrismaService, PlanLimitsService],
  exports: [PrismaService, PlanLimitsService],
})
export class PrismaModule {}
