// Mock minimal d'otplib pour les tests unitaires (évite le problème ESM de @scure/base)
export const generateSecret  = jest.fn(() => 'MOCKSECRET');
export const generateSync    = jest.fn(() => '123456');
export const verifySync      = jest.fn(() => true);
export const generateURI     = jest.fn(() => 'otpauth://totp/MockApp:test@example.ci?secret=MOCKSECRET&issuer=MockApp');
