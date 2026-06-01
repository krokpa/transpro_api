import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import dayjs from 'dayjs';
import { PrismaService } from '../prisma/prisma.service';
import { generateReference } from '@transpro/shared';
import { CreateSmsPackageDto, UpdateSmsPackageDto, PurchaseSmsPackageDto } from './dto/sms-packages.dto';

const GENIUSPAY_BASE = 'https://pay.genius.ci/api/v1/merchant';
// SMS credits n'ont pas d'expiration par défaut
const SMS_CREDIT_TTL_MONTHS: number | null = null;

@Injectable()
export class SmsPackagesService {
  private readonly logger = new Logger(SmsPackagesService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ── CRUD packages (SUPER_ADMIN) ───────────────────────────────────────────

  async listPackages(activeOnly = true) {
    return this.prisma.smsPackage.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { priceXof: 'asc' }],
    });
  }

  async createPackage(dto: CreateSmsPackageDto) {
    return this.prisma.smsPackage.create({ data: { ...dto } });
  }

  async updatePackage(id: string, dto: UpdateSmsPackageDto) {
    const pkg = await this.prisma.smsPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package introuvable');
    return this.prisma.smsPackage.update({ where: { id }, data: dto });
  }

  async deletePackage(id: string) {
    const pkg = await this.prisma.smsPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package introuvable');
    return this.prisma.smsPackage.update({ where: { id }, data: { isActive: false } });
  }

  // ── Balance tenant ────────────────────────────────────────────────────────

  async getBalance(tenantId: string) {
    const credits = await this.prisma.smsCredit.findMany({
      where: {
        tenantId,
        remaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });

    const total = credits.reduce((sum, c) => sum + c.remaining, 0);
    const customSender = credits.find((c) => c.customSender)?.customSender ?? null;

    return { total, credits, customSender };
  }

  async getLogs(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.smsLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.smsLog.count({ where: { tenantId } }),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  // ── Achat via Genius Pay ──────────────────────────────────────────────────

  async initiatePurchase(tenantId: string, dto: PurchaseSmsPackageDto) {
    const pkg = await this.prisma.smsPackage.findUnique({ where: { id: dto.packageId } });
    if (!pkg || !pkg.isActive) throw new NotFoundException('Package SMS introuvable ou désactivé');

    // Valider le customSender si requis
    if (dto.customSender && !pkg.hasCustomSender) {
      throw new BadRequestException('Ce package ne inclut pas un sender personnalisé.');
    }
    if (pkg.hasCustomSender && !dto.customSender) {
      throw new BadRequestException('Ce package nécessite un sender personnalisé (max 11 caractères alphanum).');
    }
    if (dto.customSender) {
      if (!/^[A-Z0-9]{3,11}$/i.test(dto.customSender)) {
        throw new BadRequestException('Sender : 3-11 caractères alphanumériques sans espaces.');
      }
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: {
          where: { role: 'COMPANY_OWNER' },
          select: { email: true, firstName: true, lastName: true, phone: true },
          take: 1,
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const owner = tenant.users[0];
    if (!owner) throw new BadRequestException('Aucun propriétaire trouvé');

    const transactionId = generateReference('SMS');
    const appUrl = this.config.get('FRONTEND_URL') || this.config.get('APP_URL') || 'http://localhost:3000';

    let geniusRes: any;
    try {
      geniusRes = await this.callGeniusPay({
        amount: pkg.priceXof,
        description: `Pack SMS "${pkg.name}" — ${pkg.smsCount} SMS${dto.customSender ? ` (sender: ${dto.customSender.toUpperCase()})` : ''}`,
        customer: {
          name: `${owner.firstName} ${owner.lastName}`,
          email: owner.email,
          phone: owner.phone ?? tenant.phone,
        },
        successUrl: `${appUrl}/dashboard/sms/payment/success`,
        errorUrl:   `${appUrl}/dashboard/sms/payment/error`,
        metadata: { transactionId, tenantId, packageId: dto.packageId, customSender: dto.customSender ?? null },
      });
    } catch (err) {
      this.logger.error(`GeniusPay SMS purchase init failed: tenant=${tenantId}`, err);
      throw new BadRequestException('Erreur lors de l\'initiation du paiement.');
    }

    if (!geniusRes?.checkout_url) throw new BadRequestException('Lien de paiement non reçu');

    const purchase = await this.prisma.smsPurchase.create({
      data: {
        tenantId,
        packageId: dto.packageId,
        smsCount: pkg.smsCount,
        priceXof: pkg.priceXof,
        customSender: dto.customSender?.toUpperCase() ?? null,
        providerRef: geniusRes.reference,
        checkoutUrl: geniusRes.checkout_url,
      },
    });

    return { checkoutUrl: geniusRes.checkout_url, purchaseId: purchase.id };
  }

  async handleWebhook(rawBody: string, rawSignature: string, timestamp: string) {
    const webhookSecret = this.config.get('GENIUSPAY_WEBHOOK_SECRET', '');
    if (webhookSecret && rawSignature) {
      const data = `${timestamp}.${rawBody}`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(data).digest('hex');
      const sigBuf = Buffer.from(rawSignature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new ForbiddenException('Signature webhook invalide');
      }
      if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
        throw new BadRequestException('Webhook expiré');
      }
    }

    let body: any;
    try { body = JSON.parse(rawBody); } catch { throw new BadRequestException('Payload invalide'); }

    const ref    = body?.data?.reference ?? body?.reference;
    const status = body?.data?.status    ?? body?.status;
    const meta   = body?.data?.metadata  ?? body?.metadata ?? {};

    if (!ref) return { received: true };

    if (status === 'success' || status === 'SUCCESSFUL') {
      await this.confirmPurchase(ref, meta?.paymentChannel ?? body?.data?.payment_channel);
    }

    return { received: true };
  }

  async confirmFromRedirect(purchaseId: string, tenantId: string) {
    const purchase = await this.prisma.smsPurchase.findFirst({ where: { id: purchaseId, tenantId } });
    if (!purchase) throw new NotFoundException('Achat introuvable');
    if (purchase.isPaid) return { status: 'SUCCESS', alreadyConfirmed: true };
    if (!purchase.providerRef) throw new BadRequestException('Aucune référence fournisseur');

    try {
      const res = await this.checkGeniusPayStatus(purchase.providerRef);
      const status = res?.status ?? res?.data?.status;
      if (status === 'success' || status === 'SUCCESSFUL') {
        await this.confirmPurchase(purchase.providerRef, res?.data?.payment_channel);
        return { status: 'SUCCESS' };
      }
      return { status: 'PENDING' };
    } catch {
      return { status: 'UNKNOWN' };
    }
  }

  private async confirmPurchase(providerRef: string, paymentChannel?: string) {
    const purchase = await this.prisma.smsPurchase.findFirst({
      where: { providerRef, isPaid: false },
    });
    if (!purchase) return;

    const expiresAt = SMS_CREDIT_TTL_MONTHS
      ? dayjs().add(SMS_CREDIT_TTL_MONTHS, 'month').toDate()
      : null;

    await this.prisma.$transaction([
      this.prisma.smsPurchase.update({
        where: { id: purchase.id },
        data: { isPaid: true, paidAt: new Date(), paymentMethod: paymentChannel, checkoutUrl: null },
      }),
      this.prisma.smsCredit.create({
        data: {
          tenantId: purchase.tenantId,
          remaining: purchase.smsCount,
          customSender: purchase.customSender,
          expiresAt,
        },
      }),
    ]);

    this.logger.log(`SMS purchase confirmed: tenant=${purchase.tenantId} sms=${purchase.smsCount} sender=${purchase.customSender ?? 'TRANSPRO-CI'}`);
  }

  // ── Genius Pay helpers ────────────────────────────────────────────────────

  private async callGeniusPay(params: {
    amount: number;
    description: string;
    customer: { name: string; email: string; phone: string };
    successUrl: string;
    errorUrl: string;
    metadata: Record<string, any>;
  }) {
    const apiKey    = this.config.get('GENIUSPAY_API_KEY');
    const apiSecret = this.config.get('GENIUSPAY_API_SECRET');
    const res = await axios.post(
      `${GENIUSPAY_BASE}/payments`,
      {
        amount: params.amount, currency: 'XOF',
        description: params.description,
        customer: { ...params.customer, country: 'CI' },
        success_url: params.successUrl, error_url: params.errorUrl,
        metadata: params.metadata,
      },
      { headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
    return res.data?.data ?? res.data;
  }

  private async checkGeniusPayStatus(providerRef: string) {
    const apiKey    = this.config.get('GENIUSPAY_API_KEY');
    const apiSecret = this.config.get('GENIUSPAY_API_SECRET');
    const res = await axios.get(`${GENIUSPAY_BASE}/payments/${providerRef}`, {
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret }, timeout: 10_000,
    });
    return res.data?.data ?? res.data;
  }
}
