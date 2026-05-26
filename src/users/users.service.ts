import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto, InviteTeamMemberDto } from './dto/user.dto';
import { UserRole } from '@transpro/shared';

const MEMBER_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  isVerified: true,
  lastLoginAt: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { ...MEMBER_SELECT, preferredLang: true },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        isActive: true,
        isVerified: true,
        preferredLang: true,
        lastLoginAt: true,
        createdAt: true,
        tenant: {
          select: { id: true, name: true, slug: true, logo: true, plan: true, status: true },
        },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, preferredLang: true, updatedAt: true },
    });
  }

  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Mot de passe actuel incorrect');
    if (newPassword.length < 8) throw new BadRequestException('Le nouveau mot de passe doit contenir au moins 8 caractères');

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: newHash } });
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    return { message: 'Mot de passe modifié avec succès' };
  }

  async addToTenant(userId: string, tenantId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant introuvable');
    return this.prisma.user.update({
      where: { id: userId },
      data: { tenantId, role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, tenantId: true },
    });
  }

  async inviteTeamMember(tenantId: string, dto: InviteTeamMemberDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Un compte avec cet email existe déjà');

    const allowedRoles = [UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT];
    if (!allowedRoles.includes(dto.role)) {
      throw new BadRequestException('Rôle non autorisé pour un membre de l\'équipe');
    }

    const hash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone ?? '',
        passwordHash: hash,
        role: dto.role,
        tenantId,
        isVerified: true,
        isActive: true,
      },
      select: MEMBER_SELECT,
    });
  }

  async updateRole(targetUserId: string, tenantId: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({ where: { id: targetUserId, tenantId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable dans cette compagnie');
    if (user.role === UserRole.COMPANY_OWNER) {
      throw new BadRequestException('Impossible de modifier le rôle du propriétaire');
    }
    const allowed = [UserRole.COMPANY_ADMIN, UserRole.COMPANY_AGENT];
    if (!allowed.includes(role)) throw new BadRequestException('Rôle invalide');

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { role },
      select: { id: true, role: true },
    });
  }

  async removeFromTenant(targetUserId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: targetUserId, tenantId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable dans cette compagnie');
    if (user.role === UserRole.COMPANY_OWNER) {
      throw new BadRequestException('Impossible de retirer le propriétaire de la compagnie');
    }
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { tenantId: null, role: UserRole.PASSENGER },
    });
    return { message: 'Membre retiré de la compagnie' };
  }
}
