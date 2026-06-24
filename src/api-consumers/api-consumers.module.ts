import { Module } from '@nestjs/common';
import { ApiConsumersService } from './api-consumers.service';
import { ApiConsumersController } from './api-consumers.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, BillingModule, EmailModule],
  providers: [ApiConsumersService],
  controllers: [ApiConsumersController],
  exports: [ApiConsumersService],
})
export class ApiConsumersModule {}
