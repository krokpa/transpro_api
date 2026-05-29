import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { createMockPrisma } from '../../common/test/mock-prisma';
import { NotificationType, UserRole } from '@transpro/shared';
import { PlanLimitsService } from '../../common/plan-limits.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

const mockPrisma        = createMockPrisma();
const mockNotifications = { create: jest.fn().mockResolvedValue({}) };
const mockPlanLimits    = { assertLimit: jest.fn().mockResolvedValue(undefined) };

const TENANT_ID  = 'tenant-1';
const TARGET_ID  = 'user-target';

const mockTenant = { id: TENANT_ID, name: 'Transport Express CI', logo: 'https://example.com/logo.png' };
const mockUser   = {
  id: TARGET_ID,
  email: 'agent@test.ci',
  firstName: 'Aya',
  lastName: 'Koné',
  phone: '+2250712345678',
  role: UserRole.COMPANY_AGENT,
  tenantId: TENANT_ID,
  isActive: true,
  isVerified: true,
  lastLoginAt: null,
  createdAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService,       useValue: mockPrisma        },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PlanLimitsService,    useValue: mockPlanLimits    },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    // Remettre la valeur par défaut après clearAllMocks
    mockPlanLimits.assertLimit.mockResolvedValue(undefined);
  });

  // ── inviteTeamMember ──────────────────────────────────────────────────────────

  describe('inviteTeamMember', () => {
    const dto = {
      email: 'new@test.ci',
      firstName: 'Amani',
      lastName: 'Traoré',
      password: 'secret123',
      role: UserRole.COMPANY_AGENT,
    };

    it('should create a new team member and send TEAM_MEMBER_INVITED notification', async () => {
      mockPlanLimits.assertLimit.mockResolvedValue(undefined);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.create.mockResolvedValue({ ...mockUser, email: dto.email });

      await service.inviteTeamMember(TENANT_ID, dto);

      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TEAM_MEMBER_INVITED,
          templateData: { companyName: mockTenant.name },
          companyLogo: mockTenant.logo,
        }),
      );
    });

    it('should throw ConflictException when email is already registered', async () => {
      mockPlanLimits.assertLimit.mockResolvedValue(undefined);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.inviteTeamMember(TENANT_ID, dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when plan user limit is reached', async () => {
      mockPlanLimits.assertLimit.mockRejectedValue(
        new (require('@nestjs/common').ForbiddenException)('Limite atteinte'),
      );
      await expect(service.inviteTeamMember(TENANT_ID, dto)).rejects.toThrow('Limite atteinte');
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for a SUPER_ADMIN role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteTeamMember(TENANT_ID, { ...dto, role: UserRole.SUPER_ADMIN }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for a PASSENGER role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteTeamMember(TENANT_ID, { ...dto, role: UserRole.PASSENGER }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send notification with undefined logo when tenant has no logo', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue({ ...mockTenant, logo: null });
      mockPrisma.user.create.mockResolvedValue({ ...mockUser, email: dto.email });

      await service.inviteTeamMember(TENANT_ID, dto);

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyLogo: undefined }),
      );
    });
  });

  // ── updateRole ────────────────────────────────────────────────────────────────

  describe('updateRole', () => {
    it('should update role and send TEAM_ROLE_CHANGED notification', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({ id: TARGET_ID, role: UserRole.COMPANY_ADMIN });
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);

      await service.updateRole(TARGET_ID, TENANT_ID, UserRole.COMPANY_ADMIN);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: UserRole.COMPANY_ADMIN } }),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TEAM_ROLE_CHANGED,
          templateData: { companyName: mockTenant.name },
          companyLogo: mockTenant.logo,
        }),
      );
    });

    it('should throw BadRequestException when trying to change COMPANY_OWNER role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...mockUser, role: UserRole.COMPANY_OWNER });

      await expect(
        service.updateRole(TARGET_ID, TENANT_ID, UserRole.COMPANY_AGENT),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an invalid role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      await expect(
        service.updateRole(TARGET_ID, TENANT_ID, UserRole.SUPER_ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user does not belong to the tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRole('unknown', TENANT_ID, UserRole.COMPANY_AGENT),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeFromTenant ──────────────────────────────────────────────────────────

  describe('removeFromTenant', () => {
    it('should remove user from tenant and send TEAM_MEMBER_REMOVED notification', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.update.mockResolvedValue({ ...mockUser, tenantId: null, role: UserRole.PASSENGER });

      await service.removeFromTenant(TARGET_ID, TENANT_ID);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tenantId: null, role: UserRole.PASSENGER } }),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TEAM_MEMBER_REMOVED,
          templateData: { companyName: mockTenant.name },
          companyLogo: mockTenant.logo,
        }),
      );
    });

    it('should throw BadRequestException when removing COMPANY_OWNER', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...mockUser, role: UserRole.COMPANY_OWNER });

      await expect(service.removeFromTenant(TARGET_ID, TENANT_ID)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user is not in the tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.removeFromTenant('ghost', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
