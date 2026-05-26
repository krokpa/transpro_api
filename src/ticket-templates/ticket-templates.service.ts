import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketTemplateDto, UpdateTicketTemplateDto } from './dto/ticket-template.dto';

@Injectable()
export class TicketTemplatesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateTicketTemplateDto) {
    if (dto.isDefault) {
      await this.prisma.ticketTemplate.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.ticketTemplate.create({
      data: { tenantId, ...dto, layout: dto.layout ?? [] },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.ticketTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findDefault(tenantId: string) {
    return this.prisma.ticketTemplate.findFirst({
      where: { tenantId, isDefault: true },
    });
  }

  async findOne(tenantId: string, id: string) {
    const tpl = await this.prisma.ticketTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!tpl) throw new NotFoundException('Modèle introuvable');
    return tpl;
  }

  async update(tenantId: string, id: string, dto: UpdateTicketTemplateDto) {
    await this.findOne(tenantId, id);
    if (dto.isDefault) {
      await this.prisma.ticketTemplate.updateMany({
        where: { tenantId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return this.prisma.ticketTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async setDefault(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.ticketTemplate.updateMany({
      where: { tenantId },
      data: { isDefault: false },
    });
    return this.prisma.ticketTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  async duplicate(tenantId: string, id: string) {
    const tpl = await this.findOne(tenantId, id);
    return this.prisma.ticketTemplate.create({
      data: {
        tenantId,
        name: `${tpl.name} (copie)`,
        description: tpl.description,
        paperSize: tpl.paperSize,
        isDefault: false,
        layout: tpl.layout as any,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.ticketTemplate.delete({ where: { id } });
  }
}
