import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRouteDto, UpdateRouteDto } from './dto/route.dto';

@Injectable()
export class RoutesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateRouteDto) {
    const { stops, ...routeData } = dto;

    return this.prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: {
          ...routeData,
          tenantId,
        },
      });

      if (stops && stops.length > 0) {
        await tx.routeStop.createMany({
          data: stops.map((stop) => ({
            routeId: route.id,
            cityId: stop.cityId,
            order: stop.order,
            durationFromOriginMinutes: stop.durationFromOriginMinutes,
            priceFromOrigin: stop.priceFromOrigin,
          })),
        });
      }

      return tx.route.findUnique({
        where: { id: route.id },
        include: { stops: { orderBy: { order: 'asc' }, include: { city: { select: { id: true, name: true } } } }, originCity: { select: { id: true, name: true } }, destinationCity: { select: { id: true, name: true } } },
      });
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.route.findMany({
      where: { tenantId, isActive: true },
      include: {
        stops: { orderBy: { order: 'asc' }, include: { city: { select: { id: true, name: true } } } },
        originCity: { select: { id: true, name: true } },
        destinationCity: { select: { id: true, name: true } },
        _count: { select: { trips: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, tenantId },
      include: {
        stops: { orderBy: { order: 'asc' }, include: { city: { select: { id: true, name: true } } } },
        originCity: { select: { id: true, name: true } },
        destinationCity: { select: { id: true, name: true } },
        _count: { select: { trips: true } },
      },
    });

    if (!route) throw new NotFoundException('Itinéraire introuvable');
    return route;
  }

  async update(id: string, tenantId: string, dto: UpdateRouteDto) {
    await this.findOne(id, tenantId);

    const { stops, ...routeData } = dto;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.route.update({
        where: { id },
        data: routeData,
      });

      if (stops !== undefined) {
        await tx.routeStop.deleteMany({ where: { routeId: id } });

        if (stops.length > 0) {
          await tx.routeStop.createMany({
            data: stops.map((stop) => ({
              routeId: id,
              cityId: stop.cityId,
              order: stop.order,
              durationFromOriginMinutes: stop.durationFromOriginMinutes,
              priceFromOrigin: stop.priceFromOrigin,
            })),
          });
        }
      }

      return tx.route.findUnique({
        where: { id: updated.id },
        include: { stops: { orderBy: { order: 'asc' }, include: { city: { select: { id: true, name: true } } } }, originCity: { select: { id: true, name: true } }, destinationCity: { select: { id: true, name: true } } },
      });
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    return this.prisma.route.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
