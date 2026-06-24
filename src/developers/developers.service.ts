import { Injectable, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '@transpro/shared';
import { RegisterDeveloperDto } from './dto/register-developer.dto';

@Injectable()
export class DevelopersService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  /**
   * Inscription self-service d'un développeur tiers (hors compagnie).
   * Crée un User(role DEVELOPER) + un ApiConsumer en sandbox lié, puis renvoie
   * directement les jetons de session (l'utilisateur est connecté).
   */
  async register(dto: RegisterDeveloperDto) {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('Un compte existe déjà avec cet email.');
    const existingConsumer = await this.prisma.apiConsumer.findUnique({ where: { email } });
    if (existingConsumer) throw new ConflictException('Un accès API existe déjà avec cet email.');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const parts = dto.name.trim().split(' ');
    const firstName = parts.shift() || dto.name;
    const lastName = parts.join(' ') || '-';

    const user = await this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        role: UserRole.DEVELOPER,
        passwordHash,
        isActive: true,
        isVerified: false,
      },
    });

    await this.prisma.apiConsumer.create({
      data: {
        name: dto.name,
        email,
        companyName: dto.companyName,
        plan: 'STARTER',
        accessStatus: 'SANDBOX',
        ownerUserId: user.id,
        allowedIps: [],
      },
    });

    // Connexion immédiate : renvoie { user, accessToken, refreshToken }.
    return this.auth.login({ email, password: dto.password });
  }
}
