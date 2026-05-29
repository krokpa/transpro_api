import { Module } from '@nestjs/common';
import { LuggageController } from './luggage.controller';
import { LuggageService } from './luggage.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LuggageController],
  providers: [LuggageService],
  exports: [LuggageService],
})
export class LuggageModule {}
