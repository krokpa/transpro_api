import { NotificationType } from '@transpro/shared';

type MsgFn = (d: Record<string, string>) => { title: string; message: string };
type LangEntry = { fr: MsgFn; en: MsgFn };

export const SUPPORTED_LANGS = ['fr', 'en'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const T: Partial<Record<NotificationType, LangEntry>> = {
  [NotificationType.BOOKING_CONFIRMED]: {
    fr: (d) => ({
      title: 'Réservation créée',
      message: `Votre réservation ${d.origin} → ${d.destination} est en attente de paiement.`,
    }),
    en: (d) => ({
      title: 'Booking created',
      message: `Your booking ${d.origin} → ${d.destination} is awaiting payment.`,
    }),
  },
  [NotificationType.BOOKING_CANCELLED]: {
    fr: () => ({
      title: 'Réservation annulée',
      message: 'Votre réservation a été annulée. Les sièges ont été libérés.',
    }),
    en: () => ({
      title: 'Booking cancelled',
      message: 'Your booking has been cancelled. Seats have been released.',
    }),
  },
  [NotificationType.BOOKING_EXPIRED]: {
    fr: () => ({
      title: 'Réservation expirée',
      message: "Votre réservation a expiré faute de paiement. Vous pouvez effectuer une nouvelle réservation.",
    }),
    en: () => ({
      title: 'Booking expired',
      message: 'Your booking has expired due to non-payment. You can make a new booking.',
    }),
  },
  [NotificationType.TICKET_READY]: {
    fr: () => ({
      title: 'Billet confirmé',
      message: "Votre billet a été émis. Présentez-vous à l'embarquement.",
    }),
    en: () => ({
      title: 'Ticket issued',
      message: 'Your ticket has been issued. Please proceed to boarding.',
    }),
  },
  [NotificationType.PAYMENT_SUCCESS]: {
    fr: (d) => ({
      title: 'Paiement confirmé !',
      message: `Votre billet ${d.origin} → ${d.destination} est prêt.`,
    }),
    en: (d) => ({
      title: 'Payment confirmed!',
      message: `Your ticket ${d.origin} → ${d.destination} is ready.`,
    }),
  },
  [NotificationType.PAYMENT_FAILED]: {
    fr: () => ({
      title: 'Paiement échoué',
      message: "Votre paiement n'a pas abouti. Les sièges ont été libérés.",
    }),
    en: () => ({
      title: 'Payment failed',
      message: 'Your payment was unsuccessful. Seats have been released.',
    }),
  },
  [NotificationType.TRIP_DELAYED]: {
    fr: (d) => ({
      title: 'Voyage retardé',
      message: `Votre voyage est retardé de ${d.delayMinutes} minutes.${d.notes ? ' ' + d.notes : ''}`,
    }),
    en: (d) => ({
      title: 'Trip delayed',
      message: `Your trip has been delayed by ${d.delayMinutes} minutes.${d.notes ? ' ' + d.notes : ''}`,
    }),
  },
  [NotificationType.TRIP_CANCELLED]: {
    fr: () => ({
      title: 'Voyage annulé',
      message: "Votre voyage a été annulé. Contactez la compagnie pour plus d'informations.",
    }),
    en: () => ({
      title: 'Trip cancelled',
      message: 'Your trip has been cancelled. Please contact the company for more information.',
    }),
  },
  [NotificationType.TRIP_DEPARTED]: {
    fr: (d) => ({
      title: 'Voyage en cours',
      message: `Votre voyage ${d.origin} → ${d.destination} vient de démarrer.`,
    }),
    en: (d) => ({
      title: 'Trip started',
      message: `Your trip ${d.origin} → ${d.destination} has just departed.`,
    }),
  },
  [NotificationType.TRIP_ARRIVED]: {
    fr: (d) => ({
      title: 'Voyage terminé',
      message: `Votre voyage ${d.origin} → ${d.destination} est arrivé à destination.`,
    }),
    en: (d) => ({
      title: 'Trip arrived',
      message: `Your trip ${d.origin} → ${d.destination} has arrived at its destination.`,
    }),
  },
  [NotificationType.BOARDING_REMINDER]: {
    fr: (d) => ({
      title: `Départ dans ${d.label} — ${d.origin} → ${d.destination}`,
      message: `Départ à ${d.time}${d.station ? ' · Gare: ' + d.station : ''}. Bon voyage !`,
    }),
    en: (d) => ({
      title: `Departure in ${d.label} — ${d.origin} → ${d.destination}`,
      message: `Departure at ${d.time}${d.station ? ' · Station: ' + d.station : ''}. Have a safe trip!`,
    }),
  },
  [NotificationType.TEAM_MEMBER_INVITED]: {
    fr: (d) => ({
      title: "Bienvenue dans l'équipe",
      message: `Vous avez été ajouté à l'équipe ${d.companyName}. Connectez-vous avec vos identifiants.`,
    }),
    en: (d) => ({
      title: 'Welcome to the team',
      message: `You have been added to ${d.companyName}'s team. Log in with your credentials.`,
    }),
  },
  [NotificationType.TEAM_ROLE_CHANGED]: {
    fr: (d) => ({
      title: 'Rôle modifié',
      message: `Votre rôle dans ${d.companyName} a été mis à jour.`,
    }),
    en: (d) => ({
      title: 'Role updated',
      message: `Your role in ${d.companyName} has been updated.`,
    }),
  },
  [NotificationType.TEAM_MEMBER_REMOVED]: {
    fr: (d) => ({
      title: "Retiré de l'équipe",
      message: `Vous avez été retiré de l'équipe ${d.companyName}.`,
    }),
    en: (d) => ({
      title: 'Removed from team',
      message: `You have been removed from ${d.companyName}'s team.`,
    }),
  },

  // ── Colis ─────────────────────────────────────────────────────────────────

  [NotificationType.PARCEL_COLLECTED]: {
    fr: (d) => ({
      title: 'Colis pris en charge',
      message: `Votre colis ${d.trackingCode} a été pris en charge et sera acheminé vers ${d.deliveryCity}.`,
    }),
    en: (d) => ({
      title: 'Parcel collected',
      message: `Your parcel ${d.trackingCode} has been collected and will be sent to ${d.deliveryCity}.`,
    }),
  },

  [NotificationType.PARCEL_IN_TRANSIT]: {
    fr: (d) => ({
      title: 'Colis en transit',
      message: `Votre colis ${d.trackingCode} est en route vers ${d.deliveryCity}.`,
    }),
    en: (d) => ({
      title: 'Parcel in transit',
      message: `Your parcel ${d.trackingCode} is on its way to ${d.deliveryCity}.`,
    }),
  },

  [NotificationType.PARCEL_ARRIVED]: {
    fr: (d) => ({
      title: 'Colis arrivé',
      message: `Votre colis ${d.trackingCode} est arrivé à ${d.deliveryCity}. Vous pouvez le récupérer à la gare.`,
    }),
    en: (d) => ({
      title: 'Parcel arrived',
      message: `Your parcel ${d.trackingCode} has arrived in ${d.deliveryCity}. You can collect it at the station.`,
    }),
  },

  [NotificationType.PARCEL_DELIVERED]: {
    fr: (d) => ({
      title: 'Colis livré ✓',
      message: `Votre colis ${d.trackingCode} a été remis au destinataire à ${d.deliveryCity}.`,
    }),
    en: (d) => ({
      title: 'Parcel delivered ✓',
      message: `Your parcel ${d.trackingCode} has been delivered to the recipient in ${d.deliveryCity}.`,
    }),
  },
};

/**
 * Builds translated { title, message } for all supported languages for the given type.
 * Returns an empty object if no template is registered for the type.
 */
export function buildNotificationTranslations(
  type: NotificationType,
  data: Record<string, string> = {},
): Record<SupportedLang, { title: string; message: string }> {
  const entry = T[type];
  if (!entry) return {} as any;
  const result = {} as Record<SupportedLang, { title: string; message: string }>;
  for (const lang of SUPPORTED_LANGS) {
    result[lang] = entry[lang](data);
  }
  return result;
}

/**
 * Returns the { title, message } for a single language, falling back to French.
 */
export function getNotificationText(
  type: NotificationType,
  data: Record<string, string> = {},
  lang: string = 'fr',
): { title: string; message: string } {
  const entry = T[type];
  if (!entry) return { title: '', message: '' };
  const fn = SUPPORTED_LANGS.includes(lang as SupportedLang)
    ? entry[lang as SupportedLang]
    : entry['fr'];
  return fn(data);
}
