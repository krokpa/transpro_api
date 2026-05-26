import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { AppLogger } from '../logger/app-logger.service';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = AppLogger.create('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, headers } = req;
    const correlationId = headers[CORRELATION_ID_HEADER];
    const start = Date.now();

    this.logger.log(`→ ${method} ${url}`, { correlationId });

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        const res = context.switchToHttp().getResponse();
        this.logger.log(`← ${method} ${url} ${res.statusCode} (${duration}ms)`, {
          correlationId,
          duration,
        });
      }),
      catchError((err) => {
        const duration = Date.now() - start;
        this.logger.error(
          `✗ ${method} ${url} [${err?.status ?? 500}] (${duration}ms): ${err?.message}`,
          undefined,
          { correlationId, duration },
        );
        return throwError(() => err);
      }),
    );
  }
}
