import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
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
      subject: 'Réinitialisation de votre mot de passe — TransPro CI',
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
      subject: `Réservation confirmée ${details.reference} — TransPro CI`,
      html: this.bookingConfirmationTemplate(firstName, details),
    });
  }

  async sendWelcome(to: string, firstName: string) {
    await this.send({
      to,
      subject: 'Bienvenue sur TransPro CI',
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
      subject: `Votre période d'essai expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} — TransPro CI`,
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
      subject: `Votre période d'essai est terminée — TransPro CI`,
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
      subject: `Votre abonnement expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} — TransPro CI`,
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
      subject: 'Votre abonnement est suspendu — TransPro CI',
      html: this.subscriptionExpiredTemplate(firstName, companyName, renewUrl),
    });
  }

  private async send(mail: { to: string; subject: string; html: string }) {
    try {
      await this.transporter.sendMail({
        from: `TransPro CI <${this.config.get('MAIL_FROM', 'noreply@transpro.ci')}>`,
        ...mail,
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
  .header{background:#f05a1a;padding:28px 32px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:.5px}
  .body{padding:32px}
  .body p{color:#374151;line-height:1.65;margin:0 0 16px}
  .btn{display:inline-block;background:#f05a1a;color:#fff!important;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;margin:8px 0}
  .footer{padding:20px 32px;border-top:1px solid #f1f5f9;text-align:center}
  .footer p{color:#9ca3af;font-size:12px;margin:0}
  .info-box{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin:16px 0}
  .info-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ffedd5;font-size:14px}
  .info-row:last-child{border-bottom:none}
  .label{color:#9a3412;font-weight:600}
  .value{color:#1f2937;font-weight:500}
</style></head>
<body><div class="wrap">
  <div class="header"><h1>🚌 TransPro CI</h1></div>
  <div class="body">${content}</div>
  <div class="footer"><p>TransPro CI — Voyagez en toute sérénité<br>Côte d'Ivoire</p></div>
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
      <p>Bienvenue sur <strong>TransPro CI</strong> — la plateforme de gestion et de réservation de transport en Côte d'Ivoire.</p>
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
      <p>La période d'essai gratuite de <strong>${companyName}</strong> sur TransPro CI expire dans
        <strong style="color:${urgencyColor}">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong>.
      </p>
      <div class="info-box">
        <div class="info-row"><span class="label">Compagnie</span><span class="value">${companyName}</span></div>
        <div class="info-row"><span class="label">Jours restants</span><span class="value" style="color:${urgencyColor};font-weight:700">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</span></div>
      </div>
      <p>Pour continuer à utiliser TransPro CI sans interruption, souscrivez à un abonnement avant l'expiration.</p>
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
      <p style="font-size:13px;color:#6b7280">Besoin d'aide ? Contactez notre support à <a href="mailto:support@transpro.ci">support@transpro.ci</a></p>
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
      <p style="font-size:13px;color:#6b7280">Besoin d'aide ? Contactez notre support à <a href="mailto:support@transpro.ci">support@transpro.ci</a></p>
    `);
  }
}
