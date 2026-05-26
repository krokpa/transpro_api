import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
    ]);

    const db = checks[0];

    const status = db.status === 'fulfilled' ? 'ok' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      environment: process.env.NODE_ENV ?? 'development',
      services: {
        database: db.status === 'fulfilled' ? 'ok' : 'error',
      },
    };
  }

  @Public()
  @Get('ping')
  ping() {
    return { pong: true, timestamp: new Date().toISOString() };
  }

  private async checkDatabase(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
