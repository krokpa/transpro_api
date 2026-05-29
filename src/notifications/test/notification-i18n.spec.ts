import { NotificationType } from '@transpro/shared';
import { buildNotificationTranslations, getNotificationText } from '../notification-i18n';

describe('notification-i18n', () => {
  describe('buildNotificationTranslations', () => {
    it('should return both fr and en for BOOKING_CONFIRMED', () => {
      const result = buildNotificationTranslations(NotificationType.BOOKING_CONFIRMED, {
        origin: 'Abidjan',
        destination: 'Bouaké',
      });

      expect(result.fr.title).toBe('Réservation créée');
      expect(result.fr.message).toContain('Abidjan → Bouaké');
      expect(result.en.title).toBe('Booking created');
      expect(result.en.message).toContain('Abidjan → Bouaké');
    });

    it('should interpolate delayMinutes into TRIP_DELAYED message', () => {
      const result = buildNotificationTranslations(NotificationType.TRIP_DELAYED, {
        delayMinutes: '30',
        notes: '',
      });

      expect(result.fr.message).toContain('30 minutes');
      expect(result.en.message).toContain('30 minutes');
    });

    it('should include notes in TRIP_DELAYED message when provided', () => {
      const result = buildNotificationTranslations(NotificationType.TRIP_DELAYED, {
        delayMinutes: '15',
        notes: 'Trafic dense',
      });

      expect(result.fr.message).toContain('Trafic dense');
      expect(result.en.message).toContain('Trafic dense');
    });

    it('should interpolate companyName into TEAM_MEMBER_INVITED', () => {
      const result = buildNotificationTranslations(NotificationType.TEAM_MEMBER_INVITED, {
        companyName: 'Transport Express CI',
      });

      expect(result.fr.message).toContain('Transport Express CI');
      expect(result.en.message).toContain('Transport Express CI');
    });

    it('should build BOARDING_REMINDER with station', () => {
      const result = buildNotificationTranslations(NotificationType.BOARDING_REMINDER, {
        label: '30 min',
        origin: 'Abidjan',
        destination: 'Bouaké',
        time: '08h30',
        station: 'Gare du Plateau',
      });

      expect(result.fr.title).toContain('30 min');
      expect(result.fr.message).toContain('08h30');
      expect(result.fr.message).toContain('Gare du Plateau');
      expect(result.en.message).toContain('08h30');
      expect(result.en.message).toContain('Gare du Plateau');
    });

    it('should omit station from BOARDING_REMINDER when empty', () => {
      const result = buildNotificationTranslations(NotificationType.BOARDING_REMINDER, {
        label: '2 heures',
        origin: 'Abidjan',
        destination: 'Bouaké',
        time: '10h00',
        station: '',
      });

      expect(result.fr.message).not.toContain('Gare');
      expect(result.en.message).not.toContain('Station');
    });

    it('should return empty object for type without a registered template', () => {
      const result = buildNotificationTranslations('UNKNOWN_TYPE' as NotificationType, {});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should cover all new notification types', () => {
      const types = [
        NotificationType.BOOKING_EXPIRED,
        NotificationType.TICKET_READY,
        NotificationType.PAYMENT_FAILED,
        NotificationType.TRIP_CANCELLED,
        NotificationType.TRIP_DEPARTED,
        NotificationType.TRIP_ARRIVED,
        NotificationType.TEAM_ROLE_CHANGED,
        NotificationType.TEAM_MEMBER_REMOVED,
      ];
      for (const type of types) {
        const r = buildNotificationTranslations(type, { origin: 'A', destination: 'B', companyName: 'X' });
        expect(r.fr.title).toBeTruthy();
        expect(r.en.title).toBeTruthy();
      }
    });

    it('should interpolate trackingCode and deliveryCity into PARCEL_COLLECTED', () => {
      const r = buildNotificationTranslations(NotificationType.PARCEL_COLLECTED, {
        trackingCode: 'TP-COL-0001',
        deliveryCity: 'Bouaké',
      });
      expect(r.fr.message).toContain('TP-COL-0001');
      expect(r.fr.message).toContain('Bouaké');
      expect(r.en.message).toContain('TP-COL-0001');
      expect(r.en.message).toContain('Bouaké');
    });

    it('should build PARCEL_IN_TRANSIT with trackingCode and deliveryCity', () => {
      const r = buildNotificationTranslations(NotificationType.PARCEL_IN_TRANSIT, {
        trackingCode: 'TP-COL-0002',
        deliveryCity: 'Daloa',
      });
      expect(r.fr.message).toContain('TP-COL-0002');
      expect(r.fr.message).toContain('Daloa');
      expect(r.en.message).toContain('Daloa');
    });

    it('should build PARCEL_ARRIVED with pickup instruction in French', () => {
      const r = buildNotificationTranslations(NotificationType.PARCEL_ARRIVED, {
        trackingCode: 'TP-COL-0003',
        deliveryCity: 'Yamoussoukro',
      });
      expect(r.fr.message).toContain('Yamoussoukro');
      expect(r.fr.message).toContain('gare');
      expect(r.en.message).toContain('station');
    });

    it('should build PARCEL_DELIVERED with delivery confirmation', () => {
      const r = buildNotificationTranslations(NotificationType.PARCEL_DELIVERED, {
        trackingCode: 'TP-COL-0004',
        deliveryCity: 'Abidjan',
      });
      expect(r.fr.title).toContain('livré');
      expect(r.en.title).toContain('delivered');
      expect(r.fr.message).toContain('TP-COL-0004');
    });
  });

  describe('getNotificationText', () => {
    it('should return French text for fr lang', () => {
      const result = getNotificationText(
        NotificationType.BOOKING_CANCELLED,
        {},
        'fr',
      );

      expect(result.title).toBe('Réservation annulée');
    });

    it('should return English text for en lang', () => {
      const result = getNotificationText(
        NotificationType.BOOKING_CANCELLED,
        {},
        'en',
      );

      expect(result.title).toBe('Booking cancelled');
    });

    it('should fall back to French for an unsupported lang', () => {
      const result = getNotificationText(
        NotificationType.PAYMENT_SUCCESS,
        { origin: 'Abidjan', destination: 'Bouaké' },
        'ar',
      );

      expect(result.title).toBe('Paiement confirmé !');
    });

    it('should return empty strings for unregistered type', () => {
      const result = getNotificationText('UNKNOWN' as NotificationType, {});
      expect(result.title).toBe('');
      expect(result.message).toBe('');
    });

    it('should default to French when no lang is provided', () => {
      const result = getNotificationText(NotificationType.TRIP_CANCELLED);
      expect(result.title).toBe('Voyage annulé');
    });
  });
});
