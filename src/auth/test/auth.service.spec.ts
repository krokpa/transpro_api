import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');
jest.mock('nanoid', () => ({ nanoid: () => 'mock-refresh-token-64chars' }));

const mockPrisma = createMockPrisma();

const mockUser = {
  id: 'user-1',
  email: 'test@example.ci',
  phone: '+2250712345678',
  firstName: 'Kouassi',
  lastName: 'Yao',
  passwordHash: 'hashed-password',
  role: 'PASSENGER',
  tenantId: null,
  isActive: true,
  isVerified: true,
  lastLoginAt: null,
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
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('mock-access-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: any) => {
              const config: Record<string, string> = {
                JWT_SECRET: 'test-secret',
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

    service = module.get<AuthService>(AuthService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new user and return tokens', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const result = await service.register({
        firstName: 'Kouassi',
        lastName: 'Yao',
        email: 'test@example.ci',
        phone: '+2250712345678',
        password: 'SecurePass123!',
      });

      expect(result.user).toBeDefined();
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token-64chars');
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(bcrypt.hash).toHaveBeenCalledWith('SecurePass123!', 12);
    });

    it('should throw ConflictException when email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      await expect(
        service.register({
          firstName: 'Kouassi',
          lastName: 'Yao',
          email: 'test@example.ci',
          phone: '+2250712345678',
          password: 'SecurePass123!',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({});
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.ci',
        password: 'SecurePass123!',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.email).toBe('test@example.ci');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.ci', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for unknown email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@example.ci', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for inactive account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(
        service.login({ email: 'test@example.ci', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshTokens', () => {
    it('should return new tokens for valid refresh token', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        token: 'valid-refresh-token',
        expiresAt: futureDate,
        user: mockUser,
      });
      mockPrisma.refreshToken.delete.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledTimes(1);
    });

    it('should throw UnauthorizedException for expired refresh token', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: 'expired-token',
        expiresAt: pastDate,
        user: mockUser,
      });

      await expect(service.refreshTokens('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for nonexistent token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('nonexistent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
