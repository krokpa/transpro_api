import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { RoutesModule } from './routes/routes.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { DriversModule } from './drivers/drivers.module';
import { TripsModule } from './trips/trips.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { SchedulesModule } from './schedules/schedules.module';
import { TicketTemplatesModule } from './ticket-templates/ticket-templates.module';
import { QzModule } from './qz/qz.module';
import { ReportsModule } from './reports/reports.module';
import { StationsModule } from './stations/stations.module';
import { CitiesModule } from './cities/cities.module';
import { EmailModule } from './email/email.module';
import { BillingModule } from './billing/billing.module';
import { ParcelsModule } from './parcels/parcels.module';
import { SmsModule } from './sms/sms.module';
import { OtpModule } from './otp/otp.module';
import { SmsPackagesModule } from './sms-packages/sms-packages.module';
import { AdminSmsModule } from './admin-sms/admin-sms.module';
import { LuggageModule } from './luggage/luggage.module';
import { RefundsModule } from './refunds/refunds.module';
import { PushModule } from './push/push.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { PaymentRedirectController } from './payment-redirect.controller';

@Module({
  controllers: [PaymentRedirectController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    ScheduleModule.forRoot(),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get('REDIS_URL', 'redis://localhost:6379'),
      }),
    }),

    PrismaModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    RoutesModule,
    VehiclesModule,
    DriversModule,
    TripsModule,
    BookingsModule,
    PaymentsModule,
    NotificationsModule,
    RealtimeModule,
    SchedulesModule,
    TicketTemplatesModule,
    QzModule,
    ReportsModule,
    StationsModule,
    CitiesModule,
    EmailModule,
    BillingModule,
    ParcelsModule,
    SmsModule,
    OtpModule,
    SmsPackagesModule,
    AdminSmsModule,
    LuggageModule,
    RefundsModule,
    PushModule,
    PermissionsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
