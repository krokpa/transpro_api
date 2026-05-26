import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Facturation')
@Controller({ path: 'billing', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BillingController {
  constructor(private billing: BillingService) {}

  @Post('run-check')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Déclencher manuellement la vérification des abonnements' })
  runCheck() {
    return this.billing.runNow();
  }
}
