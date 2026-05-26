import { Module } from '@nestjs/common';
import { TicketTemplatesController } from './ticket-templates.controller';
import { TicketTemplatesService } from './ticket-templates.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TicketTemplatesController],
  providers: [TicketTemplatesService],
  exports: [TicketTemplatesService],
})
export class TicketTemplatesModule {}
