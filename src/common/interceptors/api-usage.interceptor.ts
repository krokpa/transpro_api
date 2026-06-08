import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiUsageInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request  = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const consumer = request.apiConsumer;
    const apiKey   = request.apiKey;

    if (!consumer || !apiKey) return next.handle();

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response, apiKey.id, consumer.id, startedAt),
        error: (err) => this.log(request, response, apiKey.id, consumer.id, startedAt, err?.status ?? 500),
      }),
    );
  }

  private log(
    request: any,
    response: any,
    apiKeyId: string,
    consumerId: string,
    startedAt: number,
    errorStatus?: number,
  ) {
    const statusCode     = errorStatus ?? response.statusCode ?? 200;
    const responseTimeMs = Date.now() - startedAt;
    const endpoint       = request.url?.split('?')[0] ?? '';
    const method         = request.method ?? 'GET';
    const ipAddress      = request.ip ?? request.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const userAgent      = request.headers['user-agent']?.substring(0, 255);

    // Fire-and-forget : ne jamais bloquer la réponse
    this.prisma.apiUsageLog.create({
      data: { apiKeyId, consumerId, method, endpoint, statusCode, responseTimeMs, ipAddress, userAgent },
    }).catch(() => {});
  }
}
