import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QzController } from './qz.controller';

@Module({
  imports: [ConfigModule],
  controllers: [QzController],
})
export class QzModule {}
