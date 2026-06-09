import { Module } from '@nestjs/common';
import { CashProvisionsService } from './cash-provisions.service';
import { CashProvisionsController } from './cash-provisions.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CashProvisionsService],
  controllers: [CashProvisionsController],
  exports: [CashProvisionsService],
})
export class CashProvisionsModule {}
