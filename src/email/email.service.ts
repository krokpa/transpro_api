import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    private settings: PlatformSettingsService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('MAIL_HOST', 'localhost'),
      port: this.config.get<number>('MAIL_PORT', 1025),
      secure: false,
      auth: this.config.get('MAIL_USER')
        ? { user: this.config.get('MAIL_USER'), pass: this.config.get('MAIL_PASS') }
        : undefined,
    });
  }

  async sendPasswordReset(to: string, firstName: string, resetUrl: string) {
    await this.send({
      to,
      subject: 'Réinitialisation de votre mot de passe — {APP}',
      html: this.passwordResetTemplate(firstName, resetUrl),
    });
  }

  async sendBookingConfirmation(to: string, firstName: string, details: {
    reference: string;
    origin: string;
    destination: string;
    departureAt: string;
    seats: string[];
    total: string;
    companyName: string;
  }) {
    await this.send({
      to,
      subject: `Réservation confirmée ${details.reference} — {APP}`,
      html: this.bookingConfirmationTemplate(firstName, details),
    });
  }

  async sendWelcome(to: string, firstName: string) {
    await this.send({
      to,
      subject: 'Bienvenue sur {APP}',
      html: this.welcomeTemplate(firstName),
    });
  }

  async sendTrialExpiringSoon(
    to: string,
    firstName: string,
    companyName: string,
    daysLeft: number,
    renewUrl: string,
  ) {
    await this.send({
      to,
      subject: `Votre période d'essai expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} — {APP}`,
      html: this.trialExpiringSoonTemplate(firstName, companyName, daysLeft, renewUrl),
    });
  }

  async sendTrialExpired(
    to: string,
    firstName: string,
    companyName: string,
    renewUrl: string,
  ) {
    await this.send({
      to,
      subject: `Votre période d'essai est terminée — {APP}`,
      html: this.trialExpiredTemplate(firstName, companyName, renewUrl),
    });
  }

  async sendSubscriptionExpiringSoon(
    to: string,
    firstName: string,
    companyName: string,
    daysLeft: number,
    amount: number,
    renewUrl: string,
  ) {
    await this.send({
      to,
      subject: `Votre abonnement expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} — {APP}`,
      html: this.subscriptionExpiringSoonTemplate(firstName, companyName, daysLeft, amount, renewUrl),
    });
  }

  async sendSubscriptionExpired(
    to: string,
    firstName: string,
    companyName: string,
    renewUrl: string,
  ) {
    await this.send({
      to,
      subject: 'Votre abonnement est suspendu — {APP}',
      html: this.subscriptionExpiredTemplate(firstName, companyName, renewUrl),
    });
  }

  async sendSubscriptionPaymentSuccess(
    to: string,
    firstName: string,
    companyName: string,
    plan: string,
    amount: number,
    endDate: Date,
    dashboardUrl: string,
  ) {
    await this.send({
      to,
      subject: `Paiement confirmé — Abonnement ${plan} {APP}`,
      html: this.subscriptionPaymentSuccessTemplate(firstName, companyName, plan, amount, endDate, dashboardUrl),
    });
  }

  async sendSubscriptionPaymentFailed(
    to: string,
    firstName: string,
    companyName: string,
    retryUrl: string,
  ) {
    await this.send({
      to,
      subject: 'Échec du paiement — Abonnement {APP}',
      html: this.subscriptionPaymentFailedTemplate(firstName, companyName, retryUrl),
    });
  }

  async sendApiPlanPaymentSuccess(
    to: string, name: string, plan: string, amount: number, endDate: Date, dashboardUrl: string,
  ) {
    await this.send({
      to,
      subject: `Paiement confirmé — Plan API ${plan} {APP}`,
      html: this.base(`
        <p>Bonjour <strong>${name}</strong>,</p>
        <p>Votre paiement pour le <strong>plan API ${plan}</strong> a bien été reçu. Votre accès est actif.</p>
        <div class="info-box">
          <div class="info-row"><span class="label">Plan</span><span class="value">${plan}</span></div>
          <div class="info-row"><span class="label">Montant</span><span class="value">${amount.toLocaleString('fr-FR')} FCFA</span></div>
          <div class="info-row"><span class="label">Valable jusqu'au</span><span class="value">${endDate.toLocaleDateString('fr-FR')}</span></div>
        </div>
        <p style="text-align:center"><a href="${dashboardUrl}" class="btn">Gérer mon intégration</a></p>
      `),
    });
  }

  async sendEmailVerification(to: string, name: string, verifyUrl: string) {
    await this.send({
      to,
      subject: 'Vérifiez votre email — Espace Développeur {APP}',
      html: this.base(`
        <p>Bonjour <strong>${name}</strong>,</p>
        <p>Bienvenue ! Confirmez votre adresse email pour finaliser votre compte développeur et débloquer la demande d'accès production.</p>
        <p style="text-align:center"><a href="${verifyUrl}" class="btn">Vérifier mon email</a></p>
        <p style="font-size:13px;color:#6b7280">Ce lien expire dans <strong>24 heures</strong>. Vous pouvez déjà utiliser le sandbox sans vérification.</p>
        <p style="font-size:13px;color:#9ca3af;word-break:break-all">Ou copiez ce lien : ${verifyUrl}</p>
      `),
    });
  }

  async sendApiPlanExpiringSoon(to: string, name: string, plan: string, daysAhead: number, dashboardUrl: string) {
    await this.send({
      to,
      subject: `Votre plan API ${plan} expire dans ${daysAhead} jour(s) — {APP}`,
      html: this.base(`
        <p>Bonjour <strong>${name}</strong>,</p>
        <p>Votre <strong>plan API ${plan}</strong> arrive à échéance dans <strong>${daysAhead} jour(s)</strong>. Renouvelez-le pour éviter une rétrogradation vers le plan Starter (quota réduit).</p>
        <p style="text-align:center"><a href="${dashboardUrl}" class="btn">Renouveler mon plan</a></p>
      `),
    });
  }

  async sendApiPlanExpired(to: string, name: string, dashboardUrl: string) {
    await this.send({
      to,
      subject: 'Votre plan API a expiré — rétrogradation en Starter — {APP}',
      html: this.base(`
        <p>Bonjour <strong>${name}</strong>,</p>
        <p>Votre plan API payant a expiré : votre intégration est repassée au plan <strong>Starter</strong> (5 000 requêtes/mois). Vos clés restent valides.</p>
        <p style="text-align:center"><a href="${dashboardUrl}" class="btn">Choisir un plan</a></p>
      `),
    });
  }

  async sendApiProductionApproved(to: string, name: string, dashboardUrl: string) {
    await this.send({
      to,
      subject: 'Accès production API activé — {APP}',
      html: this.base(`
        <p>Bonjour <strong>${name}</strong>,</p>
        <p>Bonne nouvelle : votre demande d'<strong>accès production</strong> a été approuvée. Vous pouvez désormais générer des clés <strong>LIVE</strong> (tpk_live_).</p>
        <p style="text-align:center"><a href="${dashboardUrl}" class="btn">Créer une clé production</a></p>
      `),
    });
  }

  async sendApiProductionRejected(to: string, name: string, reason: string, dashboardUrl: string) {
    await this.send({
      to,
      subject: 'Demande d\'accès production refusée — {APP}',
      html: this.base(`
        <p>Bonjour <strong>${name}</strong>,</p>
        <p>Votre demande d'accès production n'a pas été approuvée.</p>
        <div class="info-box"><div class="info-row"><span class="label">Motif</span><span class="value">${reason}</span></div></div>
        <p>Vous pouvez corriger les points soulevés puis refaire une demande depuis votre espace.</p>
        <p style="text-align:center"><a href="${dashboardUrl}" class="btn">Retour à mon intégration</a></p>
      `),
    });
  }

  async sendParcelCreated(to: string, params: {
    senderName: string;
    trackingCode: string;
    description: string;
    weightKg: number;
    deliveryCity: string;
    fee: number;
    trackingUrl: string;
  }) {
    await this.send({
      to,
      subject: `Colis enregistré ${params.trackingCode} — {APP}`,
      html: this.parcelCreatedTemplate(params),
    });
  }

  async sendParcelStatusUpdate(to: string, params: {
    senderName: string;
    trackingCode: string;
    status: string;
    statusLabel: string;
    deliveryCity: string;
    message: string;
    trackingUrl: string;
  }) {
    await this.send({
      to,
      subject: `Colis ${params.trackingCode} — ${params.statusLabel} — {APP}`,
      html: this.parcelStatusTemplate(params),
    });
  }

  async sendSettlementPaid(to: string, params: {
    firstName:   string;
    companyName: string;
    periodLabel: string;
    netAmount:   number;
    transferRef: string;
    dashboardUrl: string;
  }) {
    await this.send({
      to,
      subject: `Reversement effectué — ${params.periodLabel} — {APP}`,
      html: this.settlementPaidTemplate(params),
    });
  }

  async sendSettlementFailed(to: string, params: {
    firstName:    string;
    companyName:  string;
    periodLabel:  string;
    netAmount:    number;
    notes?:       string;
    dashboardUrl: string;
  }) {
    await this.send({
      to,
      subject: `Reversement échoué — ${params.periodLabel} — {APP}`,
      html: this.settlementFailedTemplate(params),
    });
  }

  private async send(mail: { to: string; subject: string; html: string }) {
    try {
      const brand = await this.settings.getBrand();
      // Substitution des tokens de marque (white-label) dans le sujet et le HTML.
      const apply = (s: string) =>
        s.replaceAll('{APP}', brand.appName)
         .replaceAll('{TAGLINE}', brand.tagline)
         .replaceAll('{BRAND_COLOR}', brand.primaryColor)
         .replaceAll('{DOMAIN}', brand.domain);
      await this.transporter.sendMail({
        from: `${brand.appName} <${brand.emailFrom}>`,
        to: mail.to,
        subject: apply(mail.subject),
        html: apply(mail.html),
      });
    } catch (err) {
      this.logger.error(`Échec envoi email à ${mail.to}: ${err.message}`);
    }
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  private base(content: string) {
    return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:0}
  .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)}
  .header{background:{BRAND_COLOR};padding:28px 32px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:.5px}
  .body{padding:32px}
  .body p{color:#374151;line-height:1.65;margin:0 0 16px}
  .btn{display:inline-block;background:{BRAND_COLOR};color:#fff!important;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;margin:8px 0}
  .footer{padding:20px 32px;border-top:1px solid #f1f5f9;text-align:center}
  .footer p{color:#9ca3af;font-size:12px;margin:0}
  .info-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:16px 0}
  .info-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eef2f7;font-size:14px}
  .info-row:last-child{border-bottom:none}
  .label{color:#64748b;font-weight:600}
  .value{color:#1f2937;font-weight:500}
</style></head>
<body><div class="wrap">
  <div class="header"><h1>{APP}</h1></div>
  <div class="body">${content}</div>
  <div class="footer"><p>{APP} — {TAGLINE}</p></div>
</div></body></html>`;
  }

  private passwordResetTemplate(firstName: string, resetUrl: string) {
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
      <p style="text-align:center"><a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe</a></p>
      <p style="font-size:13px;color:#6b7280">Ce lien expire dans <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
      <p style="font-size:13px;color:#9ca3af;word-break:break-all">Ou copiez ce lien : ${resetUrl}</p>
    `);
  }

  private bookingConfirmationTemplate(firstName: string, d: {
    reference: string; origin: string; destination: string;
    departureAt: string; seats: string[]; total: string; companyName: string;
  }) {
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>Votre réservation est confirmée ! Présentez votre billet (QR code) lors de l'embarquement.</p>
      <div class="info-box">
        <div class="info-row"><span class="label">Référence</span><span class="value">${d.reference}</span></div>
        <div class="info-row"><span class="label">Trajet</span><span class="value">${d.origin} → ${d.destination}</span></div>
        <div class="info-row"><span class="label">Compagnie</span><span class="value">${d.companyName}</span></div>
        <div class="info-row"><span class="label">Départ</span><span class="value">${d.departureAt}</span></div>
        <div class="info-row"><span class="label">Sièges</span><span class="value">${d.seats.join(', ')}</span></div>
        <div class="info-row"><span class="label">Total payé</span><span class="value">${d.total}</span></div>
      </div>
      <p style="font-size:13px;color:#6b7280">Connectez-vous à votre espace passager pour télécharger votre billet.</p>
    `);
  }

  private welcomeTemplate(firstName: string) {
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>Bienvenue sur <strong>{APP}</strong> — la plateforme de gestion et de réservation de transport en Côte d'Ivoire.</p>
      <p>Vous pouvez dès maintenant rechercher des voyages, réserver vos sièges et suivre vos billets depuis votre espace passager.</p>
      <p style="text-align:center"><a href="${this.config.get('APP_URL', 'http://localhost:3000')}/login" class="btn">Accéder à mon espace</a></p>
    `);
  }

  private trialExpiringSoonTemplate(
    firstName: string,
    companyName: string,
    daysLeft: number,
    renewUrl: string,
  ) {
    const urgencyColor = daysLeft <= 3 ? '#ef4444' : '#f59e0b';
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>La période d'essai gratuite de <strong>${companyName}</strong> sur {APP} expire dans
        <strong style="color:${urgencyColor}">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong>.
      </p>
      <div class="info-box">
        <div class="info-row"><span class="label">Compagnie</span><span class="value">${companyName}</span></div>
        <div class="info-row"><span class="label">Jours restants</span><span class="value" style="color:${urgencyColor};font-weight:700">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</span></div>
      </div>
      <p>Pour continuer à utiliser {APP} sans interruption, souscrivez à un abonnement avant l'expiration.</p>
      <p style="text-align:center"><a href="${renewUrl}" class="btn">Activer mon abonnement</a></p>
      <p style="font-size:13px;color:#6b7280">Sans renouvellement, votre espace sera suspendu automatiquement à la fin de l'essai.</p>
    `);
  }

  private trialExpiredTemplate(
    firstName: string,
    companyName: string,
    renewUrl: string,
  ) {
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>La période d'essai gratuite de <strong>${companyName}</strong> est terminée. Votre espace a été <strong style="color:#ef4444">suspendu</strong>.</p>
      <p>Vos données sont conservées. Pour réactiver votre compte et reprendre l'activité, souscrivez à un abonnement dès maintenant.</p>
      <p style="text-align:center"><a href="${renewUrl}" class="btn">Réactiver mon compte</a></p>
      <p style="font-size:13px;color:#6b7280">Besoin d'aide ? Contactez notre support à <a href="mailto:support@{DOMAIN}">support@{DOMAIN}</a></p>
    `);
  }

  private subscriptionExpiringSoonTemplate(
    firstName: string,
    companyName: string,
    daysLeft: number,
    amount: number,
    renewUrl: string,
  ) {
    const urgencyColor = daysLeft <= 3 ? '#ef4444' : '#f59e0b';
    const formattedAmount = new Intl.NumberFormat('fr-CI').format(amount);
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>L'abonnement de <strong>${companyName}</strong> expire dans
        <strong style="color:${urgencyColor}">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong>.
      </p>
      <div class="info-box">
        <div class="info-row"><span class="label">Compagnie</span><span class="value">${companyName}</span></div>
        <div class="info-row"><span class="label">Jours restants</span><span class="value" style="color:${urgencyColor};font-weight:700">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</span></div>
        <div class="info-row"><span class="label">Montant mensuel</span><span class="value">${formattedAmount} FCFA</span></div>
      </div>
      <p>Renouvelez votre abonnement pour éviter toute interruption de service.</p>
      <p style="text-align:center"><a href="${renewUrl}" class="btn">Renouveler mon abonnement</a></p>
      <p style="font-size:13px;color:#6b7280">Sans renouvellement, votre espace sera suspendu automatiquement à la date d'expiration.</p>
    `);
  }

  private subscriptionExpiredTemplate(
    firstName: string,
    companyName: string,
    renewUrl: string,
  ) {
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>L'abonnement de <strong>${companyName}</strong> a expiré. Votre espace a été <strong style="color:#ef4444">suspendu</strong>.</p>
      <p>Vos données et paramètres sont intacts. Renouvelez votre abonnement pour reprendre l'activité immédiatement.</p>
      <p style="text-align:center"><a href="${renewUrl}" class="btn">Renouveler et réactiver</a></p>
      <p style="font-size:13px;color:#6b7280">Besoin d'aide ? Contactez notre support à <a href="mailto:support@{DOMAIN}">support@{DOMAIN}</a></p>
    `);
  }

  // ── Parcel templates ────────────────────────────────────────────────────────

  private parcelCreatedTemplate(p: {
    senderName: string;
    trackingCode: string;
    description: string;
    weightKg: number;
    deliveryCity: string;
    fee: number;
    trackingUrl: string;
  }) {
    const fmtFee = new Intl.NumberFormat('fr-CI').format(p.fee);
    return this.base(`
      <p>Bonjour <strong>${p.senderName}</strong>,</p>
      <p>Votre colis a bien été enregistré sur <strong>{APP}</strong>. Conservez le code de suivi ci-dessous pour suivre son acheminement.</p>
      <div class="info-box">
        <div class="info-row"><span class="label">Code de suivi</span><span class="value" style="font-size:18px;font-weight:700;color:#f05a1a;letter-spacing:1px">${p.trackingCode}</span></div>
        <div class="info-row"><span class="label">Description</span><span class="value">${p.description}</span></div>
        <div class="info-row"><span class="label">Poids</span><span class="value">${p.weightKg} kg</span></div>
        <div class="info-row"><span class="label">Destination</span><span class="value">${p.deliveryCity}</span></div>
        <div class="info-row"><span class="label">Frais d'envoi</span><span class="value">${fmtFee} FCFA</span></div>
      </div>
      <p style="text-align:center"><a href="${p.trackingUrl}" class="btn">Suivre mon colis</a></p>
      <p style="font-size:13px;color:#6b7280">Vous recevrez un email à chaque étape : prise en charge, transit, arrivée et livraison.</p>
    `);
  }

  private parcelStatusTemplate(p: {
    senderName: string;
    trackingCode: string;
    status: string;
    statusLabel: string;
    deliveryCity: string;
    message: string;
    trackingUrl: string;
  }) {
    const statusColors: Record<string, string> = {
      COLLECTED:  '#3b82f6',
      IN_TRANSIT: '#8b5cf6',
      ARRIVED:    '#f59e0b',
      DELIVERED:  '#16a34a',
      RETURNED:   '#ef4444',
    };
    const color = statusColors[p.status] ?? '#6b7280';
    return this.base(`
      <p>Bonjour <strong>${p.senderName}</strong>,</p>
      <p>Une mise à jour est disponible pour votre colis :</p>
      <div class="info-box">
        <div class="info-row"><span class="label">Code de suivi</span><span class="value">${p.trackingCode}</span></div>
        <div class="info-row">
          <span class="label">Statut</span>
          <span class="value" style="color:${color};font-weight:700">${p.statusLabel}</span>
        </div>
        <div class="info-row"><span class="label">Destination</span><span class="value">${p.deliveryCity}</span></div>
      </div>
      <p>${p.message}</p>
      <p style="text-align:center"><a href="${p.trackingUrl}" class="btn">Suivre mon colis</a></p>
    `);
  }

  private subscriptionPaymentSuccessTemplate(
    firstName: string,
    companyName: string,
    plan: string,
    amount: number,
    endDate: Date,
    dashboardUrl: string,
  ) {
    const formattedAmount = new Intl.NumberFormat('fr-CI').format(amount) + ' FCFA';
    const formattedDate   = new Intl.DateTimeFormat('fr-CI', { day: '2-digit', month: 'long', year: 'numeric' }).format(endDate);
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>🎉 Votre paiement d'abonnement a bien été reçu. Merci pour votre confiance !</p>
      <div class="info-box">
        <div class="info-row"><span class="label">Compagnie</span><span class="value">${companyName}</span></div>
        <div class="info-row"><span class="label">Plan</span><span class="value">${plan}</span></div>
        <div class="info-row"><span class="label">Montant payé</span><span class="value" style="color:#059669;font-weight:700">${formattedAmount}</span></div>
        <div class="info-row"><span class="label">Valide jusqu'au</span><span class="value">${formattedDate}</span></div>
      </div>
      <p>Votre espace {APP} est pleinement actif. Bonne gestion !</p>
      <p style="text-align:center"><a href="${dashboardUrl}" class="btn">Accéder au dashboard</a></p>
    `);
  }

  private subscriptionPaymentFailedTemplate(
    firstName: string,
    companyName: string,
    retryUrl: string,
  ) {
    return this.base(`
      <p>Bonjour <strong>${firstName}</strong>,</p>
      <p>⚠️ Le paiement de votre abonnement pour <strong>${companyName}</strong> n'a pas pu aboutir.</p>
      <p>Cela peut être dû à un solde insuffisant, une connexion interrompue ou un refus de l'opérateur.</p>
      <p>Veuillez réessayer depuis votre espace abonnement :</p>
      <p style="text-align:center"><a href="${retryUrl}" class="btn">Réessayer le paiement</a></p>
      <p style="color:#6b7280;font-size:13px">Si le problème persiste, contactez notre support : <a href="mailto:support@{DOMAIN}">support@{DOMAIN}</a></p>
    `);
  }

  private settlementPaidTemplate(p: {
    firstName: string; companyName: string; periodLabel: string;
    netAmount: number; transferRef: string; dashboardUrl: string;
  }) {
    const formatted = new Intl.NumberFormat('fr-CI').format(p.netAmount);
    return this.base(`
      <p>Bonjour <strong>${p.firstName}</strong>,</p>
      <p>Bonne nouvelle ! Le reversement de votre compagnie <strong>${p.companyName}</strong> pour la période <strong>${p.periodLabel}</strong> a été effectué avec succès.</p>
      <div class="info-box">
        <div class="info-row"><span class="label">Compagnie</span><span class="value">${p.companyName}</span></div>
        <div class="info-row"><span class="label">Période</span><span class="value">${p.periodLabel}</span></div>
        <div class="info-row"><span class="label">Montant net reversé</span><span class="value">${formatted} FCFA</span></div>
        <div class="info-row"><span class="label">Référence virement</span><span class="value">${p.transferRef}</span></div>
      </div>
      <p>Les fonds ont été envoyés sur le compte bancaire enregistré. Vérifiez votre relevé dans les prochaines 48h ouvrées.</p>
      <p style="text-align:center"><a href="${p.dashboardUrl}" class="btn">Voir le détail</a></p>
    `);
  }

  private settlementFailedTemplate(p: {
    firstName: string; companyName: string; periodLabel: string;
    netAmount: number; notes?: string; dashboardUrl: string;
  }) {
    const formatted = new Intl.NumberFormat('fr-CI').format(p.netAmount);
    return this.base(`
      <p>Bonjour <strong>${p.firstName}</strong>,</p>
      <p>⚠️ Le reversement de <strong>${p.companyName}</strong> pour la période <strong>${p.periodLabel}</strong> n'a pas pu être effectué.</p>
      <div class="info-box">
        <div class="info-row"><span class="label">Période</span><span class="value">${p.periodLabel}</span></div>
        <div class="info-row"><span class="label">Montant concerné</span><span class="value">${formatted} FCFA</span></div>
        ${p.notes ? `<div class="info-row"><span class="label">Raison</span><span class="value">${p.notes}</span></div>` : ''}
      </div>
      <p>Merci de vérifier vos coordonnées bancaires et de les mettre à jour si nécessaire, puis de contacter notre équipe.</p>
      <p style="text-align:center"><a href="${p.dashboardUrl}" class="btn">Accéder à mon espace</a></p>
      <p style="color:#6b7280;font-size:13px">Support : <a href="mailto:support@{DOMAIN}">support@{DOMAIN}</a></p>
    `);
  }
}
