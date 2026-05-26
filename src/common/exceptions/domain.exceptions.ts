import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class SeatUnavailableException extends ConflictException {
  constructor(seatNumbers: string[]) {
    super({
      code: 'SEAT_UNAVAILABLE',
      message: `Sièges indisponibles: ${seatNumbers.join(', ')}`,
      seats: seatNumbers,
    });
  }
}

export class BookingExpiredException extends BadRequestException {
  constructor() {
    super({ code: 'BOOKING_EXPIRED', message: 'La réservation a expiré. Veuillez recommencer.' });
  }
}

export class BookingAlreadyPaidException extends BadRequestException {
  constructor() {
    super({ code: 'BOOKING_ALREADY_PAID', message: 'Cette réservation est déjà payée.' });
  }
}

export class TripNotBookableException extends BadRequestException {
  constructor(status: string) {
    super({
      code: 'TRIP_NOT_BOOKABLE',
      message: `Ce voyage (statut: ${status}) n'accepte plus de réservations.`,
    });
  }
}

export class InsufficientSeatsException extends BadRequestException {
  constructor(available: number, requested: number) {
    super({
      code: 'INSUFFICIENT_SEATS',
      message: `Seulement ${available} place(s) disponible(s), ${requested} demandée(s).`,
      available,
      requested,
    });
  }
}

export class InvalidTicketException extends BadRequestException {
  constructor(reason: 'INVALID_SIGNATURE' | 'ALREADY_SCANNED' | 'NOT_CONFIRMED') {
    const messages = {
      INVALID_SIGNATURE: 'QR code invalide ou falsifié.',
      ALREADY_SCANNED: 'Ce billet a déjà été utilisé.',
      NOT_CONFIRMED: 'La réservation n\'est pas confirmée.',
    };
    super({ code: `TICKET_${reason}`, message: messages[reason] });
  }
}

export class TenantPlanLimitException extends BadRequestException {
  constructor(limit: string) {
    super({
      code: 'PLAN_LIMIT_REACHED',
      message: `Limite de votre plan atteinte: ${limit}. Passez à un plan supérieur.`,
    });
  }
}

export class ResourceNotFoundException extends NotFoundException {
  constructor(resource: string, id?: string) {
    super({
      code: 'RESOURCE_NOT_FOUND',
      message: id ? `${resource} introuvable (id: ${id}).` : `${resource} introuvable.`,
      resource,
    });
  }
}
