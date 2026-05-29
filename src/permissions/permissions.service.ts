import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProfileDto, UpdateProfileDto, AssignCompanyProfileDto, AssignStationProfileDto } from './dto/permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  /** Liste toutes les permissions disponibles (référentiel). */
  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { code: 'asc' }] });
  }

  /** Liste les profils système + les profils custom du tenant. */
  async listProfiles(tenantId: string) {
    return this.prisma.permissionProfile.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      include: { permissions: { select: { permissionCode: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  async listSystemProfiles() {
    return this.prisma.permissionProfile.findMany({
      where: { isSystem: true },
      include: { permissions: { select: { permissionCode: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getProfile(id: string, tenantId: string) {
    const profile = await this.prisma.permissionProfile.findFirst({
      where: { id, OR: [{ tenantId: null }, { tenantId }] },
      include: { permissions: { select: { permissionCode: true } } },
    });
    if (!profile) throw new NotFoundException('Profil introuvable');
    return profile;
  }

  async createProfile(tenantId: string, dto: CreateProfileDto) {
    const existing = await this.prisma.permissionProfile.findFirst({
      where: { tenantId, name: dto.name, context: dto.context as any },
    });
    if (existing) throw new BadRequestException('Un profil avec ce nom existe déjà');

    return this.prisma.permissionProfile.create({
      data: {
        tenantId,
        name: dto.name,
        context: dto.context as any,
        isSystem: false,
        permissions: {
          create: dto.permissions.map((code) => ({ permissionCode: code })),
        },
      },
      include: { permissions: { select: { permissionCode: true } } },
    });
  }

  async updateProfile(id: string, tenantId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.permissionProfile.findFirst({ where: { id, tenantId } });
    if (!profile) throw new NotFoundException('Profil introuvable');
    if (profile.isSystem) throw new ForbiddenException('Les profils système ne sont pas modifiables');

    return this.prisma.$transaction(async (tx) => {
      if (dto.permissions !== undefined) {
        await tx.permissionProfileItem.deleteMany({ where: { profileId: id } });
        await tx.permissionProfileItem.createMany({
          data: dto.permissions.map((code) => ({ profileId: id, permissionCode: code })),
        });
      }
      return tx.permissionProfile.update({
        where: { id },
        data: { ...(dto.name && { name: dto.name }) },
        include: { permissions: { select: { permissionCode: true } } },
      });
    });
  }

  async deleteProfile(id: string, tenantId: string) {
    const profile = await this.prisma.permissionProfile.findFirst({ where: { id, tenantId } });
    if (!profile) throw new NotFoundException('Profil introuvable');
    if (profile.isSystem) throw new ForbiddenException('Les profils système ne sont pas supprimables');
    await this.prisma.permissionProfile.delete({ where: { id } });
  }

  // ─── Assignation ────────────────────────────────────────────────────────────

  async assignCompanyProfile(tenantId: string, dto: AssignCompanyProfileDto) {
    const [profile, user] = await Promise.all([
      this.prisma.permissionProfile.findFirst({
        where: { id: dto.profileId, OR: [{ tenantId: null }, { tenantId }], context: 'COMPANY' },
      }),
      this.prisma.user.findFirst({ where: { id: dto.userId, tenantId } }),
    ]);
    if (!profile) throw new NotFoundException('Profil compagnie introuvable');
    if (!user) throw new NotFoundException('Utilisateur introuvable dans ce tenant');

    return this.prisma.user.update({
      where: { id: dto.userId },
      data: { companyProfileId: dto.profileId },
      select: { id: true, firstName: true, lastName: true, companyProfileId: true },
    });
  }

  async assignStationProfile(tenantId: string, dto: AssignStationProfileDto) {
    const [profile, station, userStation] = await Promise.all([
      this.prisma.permissionProfile.findFirst({
        where: { id: dto.profileId, OR: [{ tenantId: null }, { tenantId }], context: 'STATION' },
      }),
      this.prisma.station.findFirst({ where: { id: dto.stationId, tenantId } }),
      this.prisma.userStation.findUnique({
        where: { userId_stationId: { userId: dto.userId, stationId: dto.stationId } },
      }),
    ]);
    if (!profile) throw new NotFoundException('Profil gare introuvable');
    if (!station) throw new NotFoundException('Gare introuvable');
    if (!userStation) throw new NotFoundException('L\'utilisateur n\'est pas assigné à cette gare');

    return this.prisma.userStation.update({
      where: { userId_stationId: { userId: dto.userId, stationId: dto.stationId } },
      data: { stationProfileId: dto.profileId },
    });
  }

  async removeCompanyProfile(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return this.prisma.user.update({
      where: { id: userId },
      data: { companyProfileId: null },
      select: { id: true, firstName: true, lastName: true, companyProfileId: true },
    });
  }
}
