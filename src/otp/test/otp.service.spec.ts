import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OtpService } from '../otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsRouterService } from '../../sms/sms-router.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');

const mockPrisma = createMockPrisma();

const mockSmsRouter = { send: jest.fn().mockResolvedValue(undefined) };

const PHONE = '+2250712345678';

const makeOtp = (overrides: Partial<any> = {}) => ({
  id: 'otp-1',
  phone: PHONE,
  codeHash: 'hashed-code',
  attempts: 0,
  used: false,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  createdAt: new Date(),
  ...overrides,
});

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService,    useValue: mockPrisma },
        { provide: SmsRouterService, useValue: mockSmsRouter },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('mock-phone-token') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    jest.clearAllMocks();
    mockSmsRouter.send.mockResolvedValue(undefined);
  });

  // ── send ──────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('envoie un OTP et log le SMS', async () => {
      mockPrisma.phoneOtp.count.mockResolvedValue(0);
      mockPrisma.phoneOtp.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.phoneOtp.create.mockResolvedValue(makeOtp());
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-code');

      await service.send(PHONE);

      expect(mockPrisma.phoneOtp.create).toHaveBeenCalledTimes(1);
      expect(mockSmsRouter.send).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('{APP}'), // marque substituée dans SmsRouter.send (white-label)
      );
    });

    it('lève TooManyRequestsException après 3 envois dans la fenêtre', async () => {
      mockPrisma.phoneOtp.count.mockResolvedValue(3);

      await expect(service.send(PHONE)).rejects.toThrow(HttpException);
      expect(mockPrisma.phoneOtp.create).not.toHaveBeenCalled();
    });

    it('invalide les OTP précédents non utilisés avant d\'en créer un nouveau', async () => {
      mockPrisma.phoneOtp.count.mockResolvedValue(0);
      mockPrisma.phoneOtp.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.phoneOtp.create.mockResolvedValue(makeOtp());
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-code');

      await service.send(PHONE);

      expect(mockPrisma.phoneOtp.updateMany).toHaveBeenCalledWith({
        where: { phone: PHONE, used: false },
        data: { used: true },
      });
    });
  });

  // ── verify ────────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('retourne un phoneVerificationToken si le code est correct', async () => {
      mockPrisma.phoneOtp.findFirst.mockResolvedValue(makeOtp());
      mockPrisma.phoneOtp.update.mockResolvedValue({});
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const token = await service.verify(PHONE, '123456');

      expect(token).toBe('mock-phone-token');
      expect(mockPrisma.phoneOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { used: true } }),
      );
    });

    it('lève BadRequestException si aucun OTP actif', async () => {
      mockPrisma.phoneOtp.findFirst.mockResolvedValue(null);

      await expect(service.verify(PHONE, '123456')).rejects.toThrow(BadRequestException);
    });

    it('incrémente les tentatives et lève BadRequestException si code incorrect', async () => {
      mockPrisma.phoneOtp.findFirst.mockResolvedValue(makeOtp({ attempts: 0 }));
      mockPrisma.phoneOtp.update.mockResolvedValue({});
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.verify(PHONE, '000000')).rejects.toThrow(BadRequestException);

      expect(mockPrisma.phoneOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('invalide l\'OTP et lève BadRequestException si trop de tentatives', async () => {
      mockPrisma.phoneOtp.findFirst.mockResolvedValue(makeOtp({ attempts: 5 }));
      mockPrisma.phoneOtp.update.mockResolvedValue({});

      await expect(service.verify(PHONE, '000000')).rejects.toThrow(BadRequestException);

      expect(mockPrisma.phoneOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { used: true } }),
      );
    });
  });

  // ── validateToken ─────────────────────────────────────────────────────────

  describe('validateToken', () => {
    it('retourne le numéro de téléphone pour un token valide', async () => {
      const jwtSvc = { verifyAsync: jest.fn().mockResolvedValue({ phone: PHONE, type: 'phone_verified' }) };

      // Reconstruire avec un mock JWT qui supporte verifyAsync
      const moduleOverride: TestingModule = await Test.createTestingModule({
        providers: [
          OtpService,
          { provide: PrismaService,    useValue: mockPrisma },
          { provide: SmsRouterService, useValue: mockSmsRouter },
          { provide: JwtService,       useValue: jwtSvc },
          { provide: ConfigService,    useValue: { get: jest.fn().mockReturnValue('test-secret') } },
        ],
      }).compile();

      const svc = moduleOverride.get<OtpService>(OtpService);
      const phone = await svc.validateToken('valid-token');

      expect(phone).toBe(PHONE);
    });

    it('lève BadRequestException pour un token invalide', async () => {
      const jwtSvc = { verifyAsync: jest.fn().mockRejectedValue(new Error('invalid')) };

      const moduleOverride: TestingModule = await Test.createTestingModule({
        providers: [
          OtpService,
          { provide: PrismaService,    useValue: mockPrisma },
          { provide: SmsRouterService, useValue: mockSmsRouter },
          { provide: JwtService,       useValue: jwtSvc },
          { provide: ConfigService,    useValue: { get: jest.fn().mockReturnValue('test-secret') } },
        ],
      }).compile();

      const svc = moduleOverride.get<OtpService>(OtpService);
      await expect(svc.validateToken('bad-token')).rejects.toThrow(BadRequestException);
    });
  });
});
