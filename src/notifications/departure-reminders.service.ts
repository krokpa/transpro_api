import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType } from '@transpro/shared';
import dayjs from 'dayjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class DepartureRemindersService {
  private readonly logger = new Logger(DepartureRemindersService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  @Cron('0 */10 * * * *') // Runs every 10 minutes
  async sendReminders() {
    const now = new Date();

    const windows = [
      { minMin: 25,  maxMin: 35,  field: 'notified30m' as const, label: '30 min' },
      { minMin: 115, maxMin: 125, field: 'notified2h'  as const, label: '2 heures' },
    ];

    for (const { minMin, maxMin, field, label } of windows) {
      const from = new Date(now.getTime() + minMin * 60_000);
      const to   = new Date(now.getTime() + maxMin * 60_000);

      const bookings = await this.prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          [field]: false,
          trip: {
            status: { in: ['SCHEDULED', 'BOARDING'] },
            departureAt: { gte: from, lte: to },
          },
        },
        include: {
          trip: {
            include: {
              route: { include: { originCity: true, destinationCity: true } },
              departureStation: { select: { name: true, code: true } },
            },
          },
        },
      });

      if (bookings.length === 0) continue;
      this.logger.debug(`Rappels ${label}: ${bookings.length} à envoyer`);

      for (const booking of bookings) {
        try {
          const trip   = booking.trip;
          const origin = trip.route.originCity?.name ?? '';
          const dest   = trip.route.destinationCity?.name ?? '';
          const time = dayjs(trip.departureAt).format('HH[h]mm');

          await this.notifications.create({
            userId:       booking.passengerId,
            type:         NotificationType.BOARDING_REMINDER,
            templateData: {
              label,
              origin,
              destination: dest,
              time,
              station: trip.departureStation?.name ?? '',
            },
            data: { bookingId: booking.id, tripId: booking.tripId },
          });

          await this.prisma.booking.update({
            where: { id: booking.id },
            data:  { [field]: true },
          });
        } catch (err) {
          this.logger.error(`Rappel échoué pour booking ${booking.id}: ${err}`);
        }
      }
    }
  }
}
