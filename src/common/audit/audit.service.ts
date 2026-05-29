import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditOptions {
  tenantId?: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: { before?: Record<string, any>; after?: Record<string, any> };
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Enregistre une action sensible de façon non bloquante. */
  log(opts: AuditOptions): void {
    this.prisma.auditLog.create({
      data: {
        tenantId:     opts.tenantId,
        userId:       opts.userId,
        action:       opts.action,
        resourceType: opts.resourceType,
        resourceId:   opts.resourceId,
        changes:      opts.changes ?? undefined,
        ipAddress:    opts.ipAddress,
        userAgent:    opts.userAgent,
      },
    }).catch((err) => console.error('[AuditService] Failed to log:', err.message));
  }

  findByTenant(tenantId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    return Promise.all([
      this.prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.auditLog.count({ where: { tenantId } }),
    ]).then(([data, total]) => ({
      data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }));
  }
}
