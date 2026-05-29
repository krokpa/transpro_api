import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from '../common/plan-limits.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private prisma: PrismaService,
    private planLimits: PlanLimitsService,
  ) {}

  private generateSeatLayout(rows: number, columns: number) {
    const columnLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const seats: Array<{
      number: string;
      row: number;
      column: number;
      isAisle: boolean;
      class: string;
    }> = [];

    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= columns; col++) {
        const letter = columnLetters[col - 1] ?? String(col);
        seats.push({
          number: `${row}${letter}`,
          row,
          column: col,
          isAisle: false,
          class: 'STANDARD',
        });
      }
    }

    return { rows, columns, seats };
  }

  async create(tenantId: string, dto: CreateVehicleDto) {
    await this.planLimits.assertLimit(tenantId, 'vehicles');

    const existing = await this.prisma.vehicle.findUnique({
      where: { plate: dto.plate },
    });
    if (existing) {
      throw new ConflictException('Un véhicule avec cette immatriculation existe déjà');
    }

    let seatLayout: any;

    if (dto.seatLayout) {
      if (!dto.seatLayout.seats || dto.seatLayout.seats.length === 0) {
        seatLayout = this.generateSeatLayout(dto.seatLayout.rows, dto.seatLayout.columns);
      } else {
        seatLayout = dto.seatLayout;
      }
    } else {
      const defaultRows = Math.ceil(dto.capacity / 4);
      seatLayout = this.generateSeatLayout(defaultRows, 4);
    }

    return this.prisma.vehicle.create({
      data: {
        tenantId,
        plate: dto.plate,
        brand: dto.brand,
        model: dto.model,
        year: dto.year,
        capacity: dto.capacity,
        seatLayout,
        status: 'ACTIVE',
        advancedSeatManagement: dto.advancedSeatManagement ?? true,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.vehicle.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });

    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    return vehicle;
  }

  async update(id: string, tenantId: string, dto: UpdateVehicleDto) {
    await this.findOne(id, tenantId);

    const { seatLayout, ...vehicleData } = dto;

    let updateData: any = { ...vehicleData };

    if (seatLayout !== undefined) {
      if (!seatLayout.seats || seatLayout.seats.length === 0) {
        updateData.seatLayout = this.generateSeatLayout(seatLayout.rows, seatLayout.columns);
      } else {
        updateData.seatLayout = seatLayout;
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    return this.prisma.vehicle.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  // ── Fuel logs ──────────────────────────────────────────────────────────────

  async getFuelLogs(vehicleId: string, tenantId: string) {
    await this.findOne(vehicleId, tenantId);
    return this.prisma.fuelLog.findMany({
      where: { vehicleId },
      orderBy: { date: 'desc' },
      take: 50,
      include: { driver: { select: { firstName: true, lastName: true } } },
    });
  }

  async addFuelLog(vehicleId: string, tenantId: string, dto: {
    date: string; liters: number; pricePerLiter?: number; totalCost: number;
    odometer?: number; station?: string; driverId?: string; notes?: string;
  }) {
    await this.findOne(vehicleId, tenantId);
    const log = await this.prisma.fuelLog.create({
      data: {
        vehicleId, tenantId,
        date:          new Date(dto.date),
        liters:        dto.liters,
        pricePerLiter: dto.pricePerLiter,
        totalCost:     dto.totalCost,
        odometer:      dto.odometer,
        station:       dto.station,
        driverId:      dto.driverId,
        notes:         dto.notes,
      },
    });
    if (dto.odometer) {
      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { currentOdometer: dto.odometer },
      });
    }
    return log;
  }

  async deleteFuelLog(vehicleId: string, logId: string, tenantId: string) {
    await this.findOne(vehicleId, tenantId);
    return this.prisma.fuelLog.delete({ where: { id: logId } });
  }

  // ── Maintenance logs ───────────────────────────────────────────────────────

  async getMaintenanceLogs(vehicleId: string, tenantId: string) {
    await this.findOne(vehicleId, tenantId);
    return this.prisma.maintenanceLog.findMany({
      where: { vehicleId },
      orderBy: { date: 'desc' },
      take: 50,
    });
  }

  async addMaintenanceLog(vehicleId: string, tenantId: string, dto: {
    type: string; date: string; description: string; odometer?: number; cost?: number;
    nextDueAt?: string; nextDueKm?: number; garage?: string; notes?: string;
  }) {
    await this.findOne(vehicleId, tenantId);
    const log = await this.prisma.maintenanceLog.create({
      data: {
        vehicleId, tenantId,
        type:        dto.type as any,
        date:        new Date(dto.date),
        description: dto.description,
        odometer:    dto.odometer,
        cost:        dto.cost,
        nextDueAt:   dto.nextDueAt ? new Date(dto.nextDueAt) : undefined,
        nextDueKm:   dto.nextDueKm,
        garage:      dto.garage,
        notes:       dto.notes,
      },
    });
    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        lastServiceAt: new Date(dto.date),
        ...(dto.nextDueAt ? { nextServiceAt: new Date(dto.nextDueAt) } : {}),
        ...(dto.odometer ? { currentOdometer: dto.odometer } : {}),
      },
    });
    return log;
  }

  async deleteMaintenanceLog(vehicleId: string, logId: string, tenantId: string) {
    await this.findOne(vehicleId, tenantId);
    return this.prisma.maintenanceLog.delete({ where: { id: logId } });
  }

  async getMaintenanceAlerts(tenantId: string) {
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return this.prisma.vehicle.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        nextServiceAt: { lte: soon },
      },
      select: { id: true, plate: true, brand: true, model: true, nextServiceAt: true, currentOdometer: true },
      orderBy: { nextServiceAt: 'asc' },
    });
  }
}
