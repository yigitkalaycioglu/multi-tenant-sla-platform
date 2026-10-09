import nodemailer, { type Transporter } from 'nodemailer';
import type { MailSender } from '../../application/notifications/notification.ports.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export function createSmtpMailSender(config: SmtpConfig): MailSender {
  let transporter: Transporter | null = null;

  // Baglanti ilk e-postada kurulur; SMTP yoksa API/worker yine de acilir.
  const getTransporter = (): Transporter =>
    (transporter ??= nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
      connectionTimeout: 10_000,
    }));

  return {
    async send(message) {
      const info = await getTransporter().sendMail({ from: config.from, ...message });
      return { messageId: info.messageId };
    },
  };
}
