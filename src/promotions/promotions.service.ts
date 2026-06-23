import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Promotions actives pour la home passager.
   * Renvoie les promotions plateforme (tenantId null) et, si fourni,
   * celles de la compagnie [tenantId]. Filtre sur la fenêtre de validité.
   */
  async active(tenantId?: string) {
    const now = new Date();
    return this.prisma.promotion.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          {
            OR: [
              { tenantId: null },
              ...(tenantId ? [{ tenantId }] : []),
            ],
          },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        type: true,
        title: true,
        subtitle: true,
        imageUrl: true,
        code: true,
        ctaLabel: true,
        ctaUrl: true,
        color: true,
      },
    });
  }

  findAll() {
    return this.prisma.promotion.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  create(dto: CreatePromotionDto) {
    const { startsAt, endsAt, ...rest } = dto;
    return this.prisma.promotion.create({
      data: {
        ...rest,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      },
    });
  }

  async update(id: string, dto: UpdatePromotionDto) {
    await this.findOne(id);
    const { startsAt, endsAt, ...rest } = dto;
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...rest,
        ...(startsAt !== undefined
          ? { startsAt: startsAt ? new Date(startsAt) : null }
          : {}),
        ...(endsAt !== undefined
          ? { endsAt: endsAt ? new Date(endsAt) : null }
          : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.promotion.delete({ where: { id } });
  }

  private async findOne(id: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promotion introuvable');
    return promo;
  }
}
