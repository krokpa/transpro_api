import { of, lastValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from '../idempotency.interceptor';

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as any;
}

const POST_REQ = {
  method: 'POST',
  url: '/ext/bookings',
  headers: { 'idempotency-key': 'key-1' },
  apiConsumer: { id: 'c1' },
};

describe('IdempotencyInterceptor', () => {
  it('replays the stored response without invoking the handler', async () => {
    const prisma: any = {
      idempotencyKey: {
        findUnique: jest.fn().mockResolvedValue({ statusCode: 201, responseBody: { reference: 'R1' } }),
      },
    };
    const interceptor = new IdempotencyInterceptor(prisma);
    const next = { handle: jest.fn() };

    const obs = await interceptor.intercept(ctx(POST_REQ), next as any);
    const result = await lastValueFrom(obs);

    expect(result).toEqual({ reference: 'R1' });
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('passes through when no Idempotency-Key header is present', async () => {
    const prisma: any = { idempotencyKey: { findUnique: jest.fn() } };
    const interceptor = new IdempotencyInterceptor(prisma);
    const next = { handle: jest.fn().mockReturnValue(of('passthrough')) };

    const obs = await interceptor.intercept(ctx({ ...POST_REQ, headers: {} }), next as any);
    const result = await lastValueFrom(obs);

    expect(result).toBe('passthrough');
    expect(next.handle).toHaveBeenCalled();
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });
});
