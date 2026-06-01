import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { OtpService } from '../../otp/otp.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');
jest.mock('nanoid', () => ({ nanoid: () => 'mock-refresh-token-64chars' }));

const mockPrisma = createMockPrisma();

const VERIFIED_PHONE = '+2250712345678';
const PHONE_TOKEN    = 'mock-phone-verification-jwt';

const mockOtpService = {
  send:          jest.fn(),
  verify:        jest.fn(),
  validateToken: jest.fn().mockResolvedValue(VERIFIED_PHONE),
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.ci',
  phone: VERIFIED_PHONE,
  firstName: 'Kouassi',
  lastName: 'Yao',
  passwordHash: 'hashed-password',
  role: 'PASSENGER',
  tenantId: null,
  isActive: true,
  isVerified: true,
  totpEnabled: false,
  totpSecret: null,
  totpBackupCodes: [],
  lastLoginAt: null,
  userStations: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: OtpService,     useValue: mockOtpService },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('mock-access-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: any) => {
              const config: Record<string, string> = {
                JWT_SECRET:    'test-secret',
                JWT_EXPIRES_IN: '7d',
              };
              return config[key] ?? def;
            }),
          },
        },
        {
          provide: EmailService,
          useValue: { sendWelcome: jest.fn(), sendPasswordReset: jest.fn() },
        },
      ],
    }).compile();

    service    = module.get<AuthService>(AuthService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
    // Re-appliquer le mock après clearAllMocks
    mockOtpService.validateToken.mockResolvedValue(VERIFIED_PHONE);
  });

  // ── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    const validDto = {
      firstName: 'Kouassi',
      lastName:  'Yao',
      email:     'test@example.ci',
      phone:     VERIFIED_PHONE,
      password:  'SecurePass123!',
      phoneVerificationToken: PHONE_TOKEN,
    };

    it('crée un utilisateur et retourne les tokens', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const result = await service.register(validDto);

      expect(mockOtpService.validateToken).toHaveBeenCalledWith(PHONE_TOKEN);
      expect(result.user).toBeDefined();
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token-64chars');
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('lève BadRequestException si le téléphone OTP ne correspond pas', async () => {
      mockOtpService.validateToken.mockResolvedValue('+2250000000000'); // numéro différent

      await expect(service.register(validDto)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('lève ConflictException si email ou téléphone déjà utilisé', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      await expect(service.register(validDto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('passe isVerified: true à la création', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      await service.register(validDto);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isVerified: true }),
        }),
      );
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('retourne les tokens pour des identifiants valides', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: 'test@example.ci', password: 'SecurePass123!' }) as any;

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.email).toBe('test@example.ci');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('lève UnauthorizedException pour mot de passe incorrect', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login({ email: 'test@example.ci', password: 'wrong' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('lève UnauthorizedException pour email inconnu', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'unknown@example.ci', password: 'pass' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('lève UnauthorizedException pour compte inactif', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(service.login({ email: 'test@example.ci', password: 'pass' }))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ── refreshTokens ─────────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    it('retourne de nouveaux tokens pour un refresh token valide', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1', userId: 'user-1', token: 'valid-refresh-token',
        expiresAt: futureDate, user: mockUser,
      });
      mockPrisma.refreshToken.delete.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledTimes(1);
    });

    it('lève UnauthorizedException pour un refresh token expiré', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1', token: 'expired-token', expiresAt: pastDate, user: mockUser,
      });

      await expect(service.refreshTokens('expired-token'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('lève UnauthorizedException pour un token inexistant', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('nonexistent'))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
