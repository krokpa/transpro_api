import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateDriverDto) {
    const existing = await this.prisma.driver.findFirst({
      where: { licenseNumber: dto.licenseNumber, tenantId },
    });
    if (existing) {
      throw new ConflictException('Un chauffeur avec ce numéro de permis existe déjà');
    }

    return this.prisma.driver.create({
      data: {
        tenantId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        licenseNumber: dto.licenseNumber,
        licenseExpiry: new Date(dto.licenseExpiry),
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.driver.findMany({
      where: { tenantId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOne(id: string, tenantId: string) {
    const driver = await this.prisma.driver.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { trips: true } },
      },
    });

    if (!driver) throw new NotFoundException('Chauffeur introuvable');
    return driver;
  }

  async update(id: string, tenantId: string, dto: UpdateDriverDto) {
    await this.findOne(id, tenantId);

    const data: any = { ...dto };
    if (dto.licenseExpiry) {
      data.licenseExpiry = new Date(dto.licenseExpiry);
    }

    return this.prisma.driver.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    return this.prisma.driver.update({
      where: { id },
      data: { isAvailable: false },
    });
  }
}
