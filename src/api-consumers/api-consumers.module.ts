import { Module } from '@nestjs/common';
import { ApiConsumersService } from './api-consumers.service';
import { ApiConsumersController } from './api-consumers.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ApiConsumersService],
  controllers: [ApiConsumersController],
  exports: [ApiConsumersService],
})
export class ApiConsumersModule {}
