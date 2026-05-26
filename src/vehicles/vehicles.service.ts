import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

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
}
