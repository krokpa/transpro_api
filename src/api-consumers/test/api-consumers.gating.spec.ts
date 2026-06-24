import { ForbiddenException } from '@nestjs/common';
import { ApiConsumersService } from '../api-consumers.service';

function makeService(consumer: any) {
  const prisma: any = {
    apiConsumer: { findUnique: jest.fn().mockResolvedValue(consumer) },
    apiKey: { create: jest.fn().mockResolvedValue({}) },
  };
  const svc = new ApiConsumersService(prisma, {} as any, {} as any, {} as any);
  return { svc, prisma };
}

const base = { id: 'c1', plan: 'BUSINESS', tenantId: null as string | null };

describe('ApiConsumersService.createKey — LIVE production gating', () => {
  it('blocks a LIVE key when access is not APPROVED', async () => {
    const { svc } = makeService({ ...base, accessStatus: 'SANDBOX' });
    await expect(
      svc.createKey('c1', { name: 'k', environment: 'LIVE' } as any, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a LIVE key once APPROVED (tpk_live_ prefix)', async () => {
    const { svc, prisma } = makeService({ ...base, accessStatus: 'APPROVED' });
    const res: any = await svc.createKey('c1', { name: 'k', environment: 'LIVE' } as any, 'SUPER_ADMIN');
    expect(res.key).toMatch(/^tpk_live_/);
    expect(res.environment).toBe('LIVE');
    expect(prisma.apiKey.create).toHaveBeenCalled();
  });

  it('always allows a TEST key, even in SANDBOX (tpk_test_ prefix)', async () => {
    const { svc } = makeService({ ...base, accessStatus: 'SANDBOX' });
    const res: any = await svc.createKey('c1', { name: 'k', environment: 'TEST' } as any, 'SUPER_ADMIN');
    expect(res.key).toMatch(/^tpk_test_/);
    expect(res.environment).toBe('TEST');
  });
});
