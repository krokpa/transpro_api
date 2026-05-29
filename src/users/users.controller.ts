import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
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

  @Get('lookup')
  @ApiOperation({ summary: 'Rechercher un passager inscrit par numéro de téléphone' })
  lookupByPhone(@Query('phone') phone: string) {
    if (!phone) return null;
    return this.usersService.lookupByPhone(phone);
  }

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

  @Patch('avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mettre à jour sa photo de profil (base64 data URL)' })
  updateAvatar(@CurrentUser('id') userId: string, @Body('avatar') avatar: string) {
    return this.usersService.updateAvatar(userId, avatar);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changer son mot de passe' })
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enregistrer un token FCM (push notifications)' })
  registerDeviceToken(@CurrentUser('id') userId: string, @Body('token') token: string) {
    return this.usersService.registerDeviceToken(userId, token);
  }

  @Delete('device-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer un token FCM' })
  unregisterDeviceToken(@CurrentUser('id') userId: string, @Body('token') token: string) {
    return this.usersService.unregisterDeviceToken(userId, token);
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
