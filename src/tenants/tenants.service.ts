import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { UpdateDocumentBrandingDto } from './dto/document-branding.dto';
import { UserRole } from '@transpro/shared';
import dayjs from 'dayjs';

// Pre-built starter layout for a THERMAL_80 (302 × 529 px) ticket
const DEFAULT_TICKET_LAYOUT = [
  { id: 'el-001', type: 'text',   x: 10, y: 15,  width: 282, height: 30, content: '{{company_name}}', fontSize: 18, fontWeight: 'bold',   fontStyle: 'normal', textAlign: 'center', color: '#000000' },
  { id: 'el-002', type: 'line',   x: 10, y: 52,  width: 282, height: 2,  bgColor: '#d1d5db' },
  { id: 'el-003', type: 'text',   x: 10, y: 62,  width: 282, height: 22, content: '{{origin}} → {{destination}}', fontSize: 13, fontWeight: 'bold',   fontStyle: 'normal', textAlign: 'center', color: '#000000' },
  { id: 'el-004', type: 'text',   x: 10, y: 90,  width: 282, height: 20, content: '{{departure_date}} · {{departure_time}}', fontSize: 11, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center', color: '#6b7280' },
  { id: 'el-005', type: 'line',   x: 10, y: 118, width: 282, height: 1,  bgColor: '#e5e7eb' },
  { id: 'el-006', type: 'text',   x: 10, y: 128, width: 282, height: 18, content: 'Passager', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#9ca3af' },
  { id: 'el-007', type: 'text',   x: 10, y: 146, width: 282, height: 24, content: '{{passenger_name}}', fontSize: 15, fontWeight: 'bold',   fontStyle: 'normal', textAlign: 'left', color: '#000000' },
  { id: 'el-008', type: 'text',   x: 10, y: 174, width: 282, height: 18, content: '{{passenger_phone}}', fontSize: 11, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#6b7280' },
  { id: 'el-009', type: 'line',   x: 10, y: 200, width: 282, height: 1,  bgColor: '#e5e7eb' },
  { id: 'el-010', type: 'text',   x: 10, y: 210, width: 130, height: 18, content: 'Siège', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#9ca3af' },
  { id: 'el-011', type: 'text',   x: 10, y: 228, width: 130, height: 24, content: '{{seat_number}}', fontSize: 16, fontWeight: 'bold',   fontStyle: 'normal', textAlign: 'left', color: '#000000' },
  { id: 'el-012', type: 'text',   x: 152, y: 210, width: 140, height: 18, content: 'Classe', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#9ca3af' },
  { id: 'el-013', type: 'text',   x: 152, y: 228, width: 140, height: 24, content: '{{trip_class}}', fontSize: 16, fontWeight: 'bold',   fontStyle: 'normal', textAlign: 'left', color: '#000000' },
  { id: 'el-014', type: 'line',   x: 10, y: 260, width: 282, height: 1,  bgColor: '#e5e7eb' },
  { id: 'el-015', type: 'text',   x: 10, y: 270, width: 282, height: 18, content: 'Prix', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left', color: '#9ca3af' },
  { id: 'el-016', type: 'text',   x: 10, y: 288, width: 282, height: 26, content: '{{price}}', fontSize: 16, fontWeight: 'bold',   fontStyle: 'normal', textAlign: 'left', color: '#f05a1a' },
  { id: 'el-017', type: 'line',   x: 10, y: 322, width: 282, height: 2,  bgColor: '#d1d5db' },
  { id: 'el-018', type: 'qrcode', x: 111, y: 334, width: 80,  height: 80, content: '{{booking_ref}}' },
  { id: 'el-019', type: 'text',   x: 10, y: 424, width: 282, height: 18, content: '{{booking_ref}}', fontSize: 10, fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center', color: '#6b7280' },
];

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTenantDto, ownerId: string) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException('Un tenant avec ce slug existe déjà');
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 90);

    const tenant = await this.prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
          cityId: dto.cityId,
          plan: dto.plan ?? 'BASIC',
          logo: dto.logo,
          status: 'TRIAL',
          trialEndsAt,
        },
      });

      await tx.subscription.create({
        data: {
          tenantId: newTenant.id,
          plan: dto.plan ?? 'BASIC',
          amount: 0, // essai gratuit
          startDate: new Date(),
          endDate: trialEndsAt,
          isPaid: true,
        },
      });

      await tx.user.update({
        where: { id: ownerId },
        data: {
          tenantId: newTenant.id,
          role: UserRole.COMPANY_OWNER,
        },
      });

      await tx.ticketTemplate.create({
        data: {
          tenantId: newTenant.id,
          name: 'Ticket standard',
          description: 'Modèle thermique 80mm créé automatiquement',
          paperSize: 'THERMAL_80',
          isDefault: true,
          layout: DEFAULT_TICKET_LAYOUT,
        },
      });

      return newTenant;
    });

    return tenant;
  }

  async findPublic() {
    const [tenants, tripsAgg] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
        select: {
          id: true, name: true, logo: true, slug: true, phone: true,
          city: { select: { name: true } },
          _count: {
            select: {
              stations: { where: { isActive: true } },
              routes:   { where: { isActive: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.trip.groupBy({
        by: ['tenantId'],
        where: {
          status: { in: ['SCHEDULED', 'BOARDING'] },
          departureAt: { gte: new Date() },
          availableSeats: { gt: 0 },
        },
        _count: { id: true },
      }),
    ]);

    const upcomingByTenant = new Map(tripsAgg.map((t) => [t.tenantId, t._count.id]));
    return tenants.map((t) => ({ ...t, upcomingTrips: upcomingByTenant.get(t.id) ?? 0 }));
  }

  async findPublicProfile(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, logo: true, sigle: true,
        phone: true, email: true, address: true,
        latitude: true, longitude: true,
        city: { select: { name: true } },
        stations: {
          where: { isActive: true },
          select: {
            id: true, name: true, address: true, phone: true, code: true,
            latitude: true, longitude: true,
            city: { select: { name: true } },
          },
          orderBy: { name: 'asc' },
        },
        routes: {
          where: { isActive: true },
          select: {
            id: true, name: true, durationMinutes: true,
            originCity: { select: { name: true } },
            destinationCity: { select: { name: true } },
          },
          orderBy: { name: 'asc' },
        },
        _count: {
          select: {
            stations: { where: { isActive: true } },
            routes: { where: { isActive: true } },
          },
        },
      },
    });

    if (!tenant) throw new NotFoundException('Compagnie introuvable');

    const now = new Date();
    const upcomingTrips = await this.prisma.trip.count({
      where: {
        tenantId: tenant.id,
        status: { in: ['SCHEDULED', 'BOARDING'] },
        departureAt: { gte: now },
        availableSeats: { gt: 0 },
      },
    });

    return { ...tenant, upcomingTrips };
  }

  async findAll() {
    return this.prisma.tenant.findMany({
      include: {
        _count: {
          select: { users: true, routes: true, trips: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, routes: true, trips: true },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!tenant) throw new NotFoundException('Tenant introuvable');
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findOne(id);
    return this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
  }

  async updateDocumentBranding(tenantId: string, dto: UpdateDocumentBrandingDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const current = (tenant.settings as Record<string, unknown>) ?? {};
    const documentBranding: Record<string, unknown> = { logoPosition: dto.logoPosition };
    if (dto.watermarkOpacity !== undefined) documentBranding.watermarkOpacity = dto.watermarkOpacity;
    if (dto.footerText !== undefined) documentBranding.footerText = dto.footerText;

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...current, documentBranding } as any },
      select: { id: true, settings: true },
    });
  }

  async getSubscriptionHistory(tenantId: string) {
    return this.prisma.subscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
  }

  async getStats(tenantId: string) {
    const [
      revenueResult,
      totalBookings,
      uniquePassengers,
      tripsForOccupancy,
      topRoutes,
      recentBookings,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'SUCCESS' },
        _sum: { amount: true },
      }),

      this.prisma.booking.count({
        where: { tenantId },
      }),

      this.prisma.booking.findMany({
        where: { tenantId },
        select: { passengerId: true },
        distinct: ['passengerId'],
      }),

      this.prisma.trip.findMany({
        where: { tenantId },
        select: { totalSeats: true, availableSeats: true },
      }),

      this.prisma.route.findMany({
        where: { tenantId },
        include: {
          _count: { select: { trips: true } },
        },
        orderBy: {
          trips: { _count: 'desc' },
        },
        take: 5,
      }),

      this.prisma.booking.findMany({
        where: { tenantId },
        include: {
          passenger: {
            select: { firstName: true, lastName: true, email: true, phone: true },
          },
          trip: {
            select: {
              departureAt: true,
              route: { select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const totalRevenue = revenueResult._sum.amount ?? 0;
    const totalPassengers = uniquePassengers.length;

    let occupancyRate = 0;
    if (tripsForOccupancy.length > 0) {
      const totalSeats = tripsForOccupancy.reduce((acc, t) => acc + t.totalSeats, 0);
      const totalAvailable = tripsForOccupancy.reduce((acc, t) => acc + t.availableSeats, 0);
      const occupied = totalSeats - totalAvailable;
      occupancyRate = totalSeats > 0 ? Math.round((occupied / totalSeats) * 100) : 0;
    }

    return {
      totalRevenue,
      totalBookings,
      totalPassengers,
      occupancyRate,
      topRoutes,
      recentBookings,
    };
  }

  async getAnalytics(tenantId: string, period: string = '30d') {
    const now = dayjs();

    const periodMap: Record<string, { n: number; unit: dayjs.ManipulateType }> = {
      '7d':  { n: 7,  unit: 'day'   },
      '30d': { n: 30, unit: 'day'   },
      '90d': { n: 90, unit: 'day'   },
      '12m': { n: 12, unit: 'month' },
    };
    const { n, unit } = periodMap[period] ?? periodMap['30d'];
    const isMonthly = unit === 'month';

    const start     = now.subtract(n, unit).startOf(isMonthly ? 'month' : 'day').toDate();
    const prevStart = now.subtract(n * 2, unit).startOf(isMonthly ? 'month' : 'day').toDate();
    const end       = now.toDate();

    const [
      currentPayments,
      prevRevenueAgg,
      currentBookingsCount,
      prevBookingsCount,
      currentPassengers,
      prevPassengers,
      statusBreakdown,
      tripsInPeriod,
      paymentMethodsAgg,
      recentBookings,
    ] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, status: 'SUCCESS', paidAt: { gte: start, lte: end } },
        select: { amount: true, paidAt: true, method: true },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'SUCCESS', paidAt: { gte: prevStart, lt: start } },
        _sum: { amount: true },
      }),
      this.prisma.booking.count({
        where: { tenantId, createdAt: { gte: start, lte: end } },
      }),
      this.prisma.booking.count({
        where: { tenantId, createdAt: { gte: prevStart, lt: start } },
      }),
      this.prisma.booking.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        select: { passengerId: true },
        distinct: ['passengerId'],
      }),
      this.prisma.booking.findMany({
        where: { tenantId, createdAt: { gte: prevStart, lt: start } },
        select: { passengerId: true },
        distinct: ['passengerId'],
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: { gte: start, lte: end } },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.trip.findMany({
        where: { tenantId, departureAt: { gte: start, lte: end } },
        select: { totalSeats: true, availableSeats: true, status: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { tenantId, status: 'SUCCESS', paidAt: { gte: start, lte: end } },
        _count: { id: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
      this.prisma.booking.findMany({
        where: { tenantId, createdAt: { gte: start, lte: end } },
        include: {
          passenger: { select: { firstName: true, lastName: true } },
          trip: { select: { route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    // ── KPIs ────────────────────────────────────────────────────────────────
    const currentRevenue    = currentPayments.reduce((s, p) => s + p.amount, 0);
    const previousRevenue   = prevRevenueAgg._sum.amount ?? 0;
    const currentPassCount  = currentPassengers.length;
    const prevPassCount     = prevPassengers.length;

    const totalSeats    = tripsInPeriod.reduce((s, t) => s + t.totalSeats, 0);
    const occupiedSeats = tripsInPeriod.reduce((s, t) => s + (t.totalSeats - t.availableSeats), 0);
    const occupancyRate = totalSeats > 0 ? Math.round((occupiedSeats / totalSeats) * 100) : 0;

    const calcChange = (cur: number, prev: number) =>
      prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);

    const kpis = {
      revenue:    { current: currentRevenue,   previous: previousRevenue, change: calcChange(currentRevenue, previousRevenue) },
      bookings:   { current: currentBookingsCount, previous: prevBookingsCount, change: calcChange(currentBookingsCount, prevBookingsCount) },
      passengers: { current: currentPassCount,  previous: prevPassCount,   change: calcChange(currentPassCount, prevPassCount) },
      occupancy:  { current: occupancyRate, totalTrips: tripsInPeriod.length },
    };

    // ── Revenue + bookings timeline ──────────────────────────────────────────
    const fmt = isMonthly ? 'YYYY-MM' : 'YYYY-MM-DD';
    const slots = new Map<string, { revenue: number; bookings: number }>();

    let cursor = dayjs(start);
    const endDjs = dayjs(end);
    while (cursor.isBefore(endDjs) || cursor.isSame(endDjs, isMonthly ? 'month' : 'day')) {
      slots.set(cursor.format(fmt), { revenue: 0, bookings: 0 });
      cursor = cursor.add(1, isMonthly ? 'month' : 'day');
    }
    for (const p of currentPayments) {
      const key = dayjs(p.paidAt).format(fmt);
      const slot = slots.get(key);
      if (slot) slot.revenue += p.amount;
    }

    // Fetch booking createdAt for timeline
    const bookingDates = await this.prisma.booking.findMany({
      where: { tenantId, createdAt: { gte: start, lte: end } },
      select: { createdAt: true },
    });
    for (const b of bookingDates) {
      const key = dayjs(b.createdAt).format(fmt);
      const slot = slots.get(key);
      if (slot) slot.bookings += 1;
    }

    const timeline = Array.from(slots.entries()).map(([date, v]) => ({ date, ...v }));

    // ── Top routes ───────────────────────────────────────────────────────────
    const bookingsForRoutes = await this.prisma.booking.findMany({
      where: {
        tenantId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        createdAt: { gte: start, lte: end },
      },
      select: {
        totalAmount: true,
        seatNumbers: true,
        trip: { select: { route: { select: { id: true, name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
      },
      take: 5000,
    });

    const routeMap = new Map<string, { name: string; origin: string; destination: string; revenue: number; bookings: number; seats: number }>();
    for (const b of bookingsForRoutes) {
      const r = b.trip?.route;
      if (!r) continue;
      const e = routeMap.get(r.id) ?? { name: r.name, origin: (r as any).originCity?.name ?? '', destination: (r as any).destinationCity?.name ?? '', revenue: 0, bookings: 0, seats: 0 };
      e.revenue += b.totalAmount;
      e.bookings += 1;
      e.seats += b.seatNumbers.length;
      routeMap.set(r.id, e);
    }
    const topRoutes = Array.from(routeMap.entries())
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ── Fill rate per route ──────────────────────────────────────────────────
    const tripsPerRoute = await this.prisma.trip.groupBy({
      by: ['routeId'],
      where: { tenantId, departureAt: { gte: start, lte: end } },
      _sum: { totalSeats: true, availableSeats: true },
    });
    const routeFillRate = await Promise.all(
      tripsPerRoute.map(async (r) => {
        const route = await this.prisma.route.findUnique({
          where: { id: r.routeId },
          select: { name: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } },
        });
        const total    = r._sum.totalSeats ?? 0;
        const avail    = r._sum.availableSeats ?? 0;
        const occupied = total - avail;
        return {
          routeId:     r.routeId,
          name:        route?.name ?? '—',
          origin:      (route as any)?.originCity?.name ?? '',
          destination: (route as any)?.destinationCity?.name ?? '',
          fillRate:    total > 0 ? Math.round((occupied / total) * 100) : 0,
          totalSeats:  total,
        };
      }),
    );
    routeFillRate.sort((a, b) => b.fillRate - a.fillRate);

    // ── Booking status breakdown ─────────────────────────────────────────────
    const STATUS_LABELS: Record<string, string> = {
      PENDING: 'En attente', CONFIRMED: 'Confirmée',
      CANCELLED: 'Annulée', COMPLETED: 'Terminée',
    };
    const STATUS_COLORS: Record<string, string> = {
      PENDING: '#f59e0b', CONFIRMED: '#10b981',
      CANCELLED: '#ef4444', COMPLETED: '#6b7280',
    };
    const statusData = statusBreakdown.map((s) => ({
      status: s.status,
      label: STATUS_LABELS[s.status] ?? s.status,
      color: STATUS_COLORS[s.status] ?? '#94a3b8',
      count: s._count.id,
      revenue: s._sum.totalAmount ?? 0,
    }));

    // ── Payment methods ──────────────────────────────────────────────────────
    const METHOD_LABELS: Record<string, string> = {
      CASH: 'Espèces (guichet)', GENIUS_PAY: 'Genius Pay',
      ORANGE_MONEY: 'Orange Money', MTN_MOMO: 'MTN MoMo', WAVE: 'Wave',
    };
    const paymentMethods = paymentMethodsAgg.map((m) => ({
      method: m.method,
      label: METHOD_LABELS[m.method] ?? m.method,
      count: m._count.id,
      revenue: m._sum.amount ?? 0,
    }));

    return {
      period,
      kpis,
      timeline,
      topRoutes,
      routeFillRate,
      statusBreakdown: statusData,
      paymentMethods,
      recentBookings,
    };
  }

  // ─── Super Admin ───────────────────────────────────────────────────────────

  /** KPIs globaux plateforme pour le dashboard super admin. */
  async getPlatformStats() {
    const thirtyDaysAgo = dayjs().subtract(30, 'day').toDate();

    const [
      totalTenants,
      activeTenants,
      trialTenants,
      suspendedTenants,
      newTenantsThisMonth,
      totalUsers,
      totalBookings,
      totalRevenue,
      revenueThisMonth,
      totalTrips,
      recentTenants,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'TRIAL' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
      this.prisma.booking.count({ where: { status: 'CONFIRMED' } }),
      this.prisma.payment.aggregate({ where: { status: 'SUCCESS' }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', paidAt: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }),
      this.prisma.trip.count(),
      this.prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, slug: true, plan: true, status: true, createdAt: true },
      }),
    ]);

    return {
      tenants: { total: totalTenants, active: activeTenants, trial: trialTenants, suspended: suspendedTenants, newThisMonth: newTenantsThisMonth },
      users: { total: totalUsers },
      bookings: { confirmed: totalBookings },
      revenue: { total: totalRevenue._sum.amount ?? 0, thisMonth: revenueThisMonth._sum.amount ?? 0 },
      trips: { total: totalTrips },
      recentTenants,
    };
  }

  /** Détail complet d'un tenant pour le super admin. */
  async getTenantFullDetail(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        city: { select: { name: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 6 },
        _count: {
          select: { users: true, routes: true, trips: true, bookings: true, drivers: true, vehicles: true, stations: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const [revenue, bookings, users] = await Promise.all([
      this.prisma.payment.aggregate({ where: { tenantId: id, status: 'SUCCESS' }, _sum: { amount: true, commissionAmount: true } }),
      this.prisma.booking.groupBy({ by: ['status'], where: { tenantId: id }, _count: true }),
      this.prisma.user.findMany({
        where: { tenantId: id },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      ...tenant,
      stats: {
        totalRevenue: revenue._sum.amount ?? 0,
        totalCommission: revenue._sum.commissionAmount ?? 0,
        bookingsByStatus: Object.fromEntries(bookings.map((b) => [b.status, b._count])),
      },
      recentUsers: users,
    };
  }

  /** Liste tous les utilisateurs du système (super admin). */
  async getAllUsers(page = 1, limit = 30, search?: string, role?: string) {
    const skip = (page - 1) * limit;
    const where: any = { role: { not: 'SUPER_ADMIN' as any } };
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { phone:     { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where, skip, take: limit,
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          role: true, isActive: true, createdAt: true, lastLoginAt: true,
          tenant: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Setup Progress ────────────────────────────────────────────────────────

  async getSetupProgress(tenantId: string, userId: string, userRole: string) {
    if (userRole === UserRole.COMPANY_OWNER || userRole === UserRole.COMPANY_ADMIN) {
      return this.computeOwnerProgress(tenantId);
    }
    if (userRole === UserRole.COMPANY_AGENT) {
      return this.computeAgentProgress(tenantId, userId);
    }
    return { role: userRole, overall: 100, isComplete: true, milestoneReached: 'OPERATIONAL', nextStep: null, steps: [] };
  }

  private async computeOwnerProgress(tenantId: string) {
    const [tenant, stationCount, vehicleCount, driverCount, routeCount, tripCount, bookingCount, paymentCount] =
      await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { logo: true, address: true, phone: true },
        }),
        this.prisma.station.count({ where: { tenantId, isActive: true } }),
        this.prisma.vehicle.count({ where: { tenantId, status: 'ACTIVE' } }),
        this.prisma.driver.count({ where: { tenantId } }),
        this.prisma.route.count({ where: { tenantId, isActive: true } }),
        this.prisma.trip.count({ where: { tenantId } }),
        this.prisma.booking.count({ where: { tenantId } }),
        this.prisma.payment.count({ where: { tenantId, status: 'SUCCESS' } }),
      ]);

    const companyOk  = !!(tenant?.logo && tenant?.address && tenant?.phone);
    const stationOk  = stationCount  > 0;
    const vehicleOk  = vehicleCount  > 0;
    const driverOk   = driverCount   > 0;
    const routeOk    = routeCount    > 0;
    const tripOk     = tripCount     > 0;
    const bookingOk  = bookingCount  > 0;
    const paymentOk  = paymentCount  > 0;

    const steps = [
      {
        id: 'company_info',
        title: 'Informations société',
        description: 'Logo, contact et adresse de votre compagnie',
        status: companyOk ? 'COMPLETED' : 'PENDING',
        percentage: 10,
        icon: 'business',
        route: '/owner/profile',
        action: 'Compléter le profil',
        blockedReason: null,
        blockedAction: null,
        blockedRoute: null,
      },
      {
        id: 'first_station',
        title: 'Première gare',
        description: 'Créez au moins un point de départ ou d\'arrivée',
        status: stationOk ? 'COMPLETED' : 'PENDING',
        percentage: 15,
        icon: 'location_city',
        route: '/owner/stations',
        action: 'Créer une gare',
        blockedReason: null,
        blockedAction: null,
        blockedRoute: null,
      },
      {
        id: 'first_vehicle',
        title: 'Premier véhicule',
        description: 'Ajoutez un bus ou minibus à votre flotte',
        status: vehicleOk ? 'COMPLETED' : 'PENDING',
        percentage: 15,
        icon: 'directions_bus',
        route: '/owner/fleet',
        action: 'Ajouter un véhicule',
        blockedReason: null,
        blockedAction: null,
        blockedRoute: null,
      },
      {
        id: 'first_driver',
        title: 'Premier chauffeur',
        description: 'Enregistrez un chauffeur dans votre équipe',
        status: driverOk ? 'COMPLETED' : 'PENDING',
        percentage: 10,
        icon: 'person',
        route: '/owner/drivers',
        action: 'Ajouter un chauffeur',
        blockedReason: null,
        blockedAction: null,
        blockedRoute: null,
      },
      {
        id: 'first_route',
        title: 'Première ligne',
        description: 'Définissez un itinéraire entre deux villes',
        status: routeOk ? 'COMPLETED' : 'PENDING',
        percentage: 15,
        icon: 'alt_route',
        route: '/owner/routes',
        action: 'Créer une ligne',
        blockedReason: null,
        blockedAction: null,
        blockedRoute: null,
      },
      {
        id: 'first_trip',
        title: 'Premier voyage',
        description: 'Planifiez votre premier départ',
        status: tripOk    ? 'COMPLETED'
               : (vehicleOk && routeOk) ? 'PENDING'
               : 'BLOCKED',
        percentage: 20,
        icon: 'departure_board',
        route: '/owner/trips',
        action: 'Créer un voyage',
        blockedReason: !vehicleOk && !routeOk ? 'Ajoutez d\'abord un véhicule et une ligne'
                     : !vehicleOk             ? 'Ajoutez d\'abord un véhicule'
                     : !routeOk              ? 'Créez d\'abord une ligne'
                     : null,
        blockedAction: !vehicleOk ? 'Ajouter un véhicule' : !routeOk ? 'Créer une ligne' : null,
        blockedRoute:  !vehicleOk ? '/owner/fleet'        : !routeOk ? '/owner/routes'   : null,
      },
      {
        id: 'first_booking',
        title: 'Première réservation',
        description: 'Recevez ou effectuez la première vente',
        status: bookingOk ? 'COMPLETED' : tripOk ? 'PENDING' : 'BLOCKED',
        percentage: 10,
        icon: 'confirmation_num',
        route: null,
        action: null,
        blockedReason: !tripOk ? 'Vous devez d\'abord créer un voyage' : null,
        blockedAction: !tripOk ? 'Créer un voyage' : null,
        blockedRoute:  !tripOk ? '/owner/trips'   : null,
      },
      {
        id: 'first_payment',
        title: 'Premier paiement',
        description: 'Encaissez votre premier passager',
        status: paymentOk ? 'COMPLETED' : bookingOk ? 'PENDING' : 'BLOCKED',
        percentage: 5,
        icon: 'payments',
        route: null,
        action: null,
        blockedReason: !bookingOk ? 'Aucune réservation reçue pour le moment' : null,
        blockedAction: null,
        blockedRoute: null,
      },
    ];

    const overall    = steps.reduce((s, step) => step.status === 'COMPLETED' ? s + step.percentage : s, 0);
    const nextStep   = steps.find((s) => s.status !== 'COMPLETED') ?? null;
    const milestone  = overall >= 100 ? 'OPERATIONAL'
                     : overall >= 75  ? 'ALMOST_READY'
                     : overall >= 50  ? 'ADVANCED'
                     : overall > 0    ? 'STARTED'
                     : 'NOT_STARTED';

    return { role: 'COMPANY_OWNER', overall, isComplete: overall >= 100, milestoneReached: milestone, nextStep, steps };
  }

  private async computeAgentProgress(tenantId: string, userId: string) {
    const [stationCount, bookingCount] = await Promise.all([
      this.prisma.userStation.count({ where: { userId } }),
      this.prisma.booking.count({
        where: { tenantId, soldByStation: { userStations: { some: { userId } } } },
      }),
    ]);

    const stationOk = stationCount > 0;
    const saleOk    = bookingCount > 0;

    const steps = [
      {
        id: 'station_assigned',
        title: 'Affectation à une gare',
        description: 'Vous devez être affecté à une gare par votre responsable',
        status: stationOk ? 'COMPLETED' : 'BLOCKED',
        percentage: 50,
        icon: 'location_city',
        route: null,
        action: null,
        blockedReason: !stationOk ? 'Demandez à votre responsable de vous affecter à une gare' : null,
        blockedAction: null,
        blockedRoute: null,
      },
      {
        id: 'first_sale',
        title: 'Première vente',
        description: 'Effectuez votre première vente au guichet',
        status: saleOk ? 'COMPLETED' : stationOk ? 'PENDING' : 'BLOCKED',
        percentage: 50,
        icon: 'point_of_sale',
        route: '/agent/guichet',
        action: 'Ouvrir le guichet',
        blockedReason: !stationOk ? 'Vous n\'êtes pas encore affecté à une gare' : null,
        blockedAction: null,
        blockedRoute: null,
      },
    ];

    const overall   = steps.reduce((s, step) => step.status === 'COMPLETED' ? s + step.percentage : s, 0);
    const nextStep  = steps.find((s) => s.status !== 'COMPLETED') ?? null;
    const milestone = overall >= 100 ? 'OPERATIONAL' : overall > 0 ? 'STARTED' : 'NOT_STARTED';

    return { role: 'COMPANY_AGENT', overall, isComplete: overall >= 100, milestoneReached: milestone, nextStep, steps };
  }
}
