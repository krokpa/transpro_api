import { Module } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { SettlementsController } from './settlements.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  providers: [SettlementsService],
  controllers: [SettlementsController],
  exports: [SettlementsService],
})
export class SettlementsModule {}
