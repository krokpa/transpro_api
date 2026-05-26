import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto, ChangePasswordDto, AddToTenantDto, InviteTeamMemberDto, UpdateRoleDto } from './dto/user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@transpro/shared';

@ApiTags('Utilisateurs')
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('team')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Lister les membres de la compagnie' })
  findTeam(@CurrentUser('tenantId') tenantId: string) {
    return this.usersService.findAll(tenantId);
  }

  @Post('invite')
  @Roles(UserRole.COMPANY_OWNER, UserRole.COMPANY_ADMIN)
  @ApiOperation({ summary: "Inviter un nouveau membre dans l'équipe" })
  inviteTeamMember(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: InviteTeamMemberDto,
  ) {
    return this.usersService.inviteTeamMember(tenantId, dto);
  }

  @Patch(':id/role')
  @Roles(UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: "Changer le rôle d'un membre" })
  updateRole(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') targetId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(targetId, tenantId, dto.role);
  }

  @Delete(':id/from-tenant')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Retirer un membre de la compagnie' })
  removeFromTenant(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') targetId: string,
  ) {
    return this.usersService.removeFromTenant(targetId, tenantId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Mettre à jour son propre profil' })
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(userId, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changer son mot de passe' })
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @Post('add-to-tenant')
  @Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_OWNER)
  @ApiOperation({ summary: 'Assigner un utilisateur à une compagnie' })
  addToTenant(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: AddToTenantDto,
  ) {
    return this.usersService.addToTenant(dto.userId, tenantId, dto.role);
  }
}
