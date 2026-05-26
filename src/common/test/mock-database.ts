/**
 * Mock complet du module @transpro/database pour les tests unitaires.
 * Évite d'instancier le vrai PrismaClient (qui nécessite une DB active).
 */

export const PrismaClient = jest.fn().mockImplementation(() => ({
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
}));

export { PrismaClient as default };

// Re-export des enums Prisma utilisés dans les services
export const BookingStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
} as const;

export const TripStatus = {
  SCHEDULED: 'SCHEDULED',
  BOARDING: 'BOARDING',
  DEPARTED: 'DEPARTED',
  ARRIVED: 'ARRIVED',
  CANCELLED: 'CANCELLED',
  DELAYED: 'DELAYED',
} as const;

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;

export const SeatStatus = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  OCCUPIED: 'OCCUPIED',
  BLOCKED: 'BLOCKED',
} as const;

// prisma singleton mock
export const prisma = new (PrismaClient as any)();
