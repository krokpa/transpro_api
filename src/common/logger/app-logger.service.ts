import { Injectable, LoggerService, Scope } from '@nestjs/common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  level: LogLevel;
  context?: string;
  message: string;
  correlationId?: string;
  duration?: number;
  [key: string]: unknown;
}

@Injectable({ scope: Scope.DEFAULT })
export class AppLogger implements LoggerService {
  private context?: string;

  static create(context: string): AppLogger {
    const logger = new AppLogger();
    logger.setContext(context);
    return logger;
  }

  setContext(context: string) {
    this.context = context;
  }

  private format(entry: LogEntry): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
      context: entry.context ?? this.context,
    });
  }

  log(message: string, meta?: Record<string, unknown>) {
    process.stdout.write(this.format({ level: 'info', message, ...meta }) + '\n');
  }

  error(message: string, trace?: string, meta?: Record<string, unknown>) {
    process.stderr.write(this.format({ level: 'error', message, trace, ...meta }) + '\n');
  }

  warn(message: string, meta?: Record<string, unknown>) {
    process.stdout.write(this.format({ level: 'warn', message, ...meta }) + '\n');
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write(this.format({ level: 'debug', message, ...meta }) + '\n');
    }
  }

  verbose(message: string) {
    this.debug(message);
  }

  fatal(message: string, meta?: Record<string, unknown>) {
    process.stderr.write(this.format({ level: 'fatal', message, ...meta }) + '\n');
  }

  withCorrelation(correlationId: string) {
    const child = AppLogger.create(this.context ?? '');
    const originalFormat = child['format'].bind(child);
    child['format'] = (entry: LogEntry) =>
      originalFormat({ ...entry, correlationId });
    return child;
  }
}
