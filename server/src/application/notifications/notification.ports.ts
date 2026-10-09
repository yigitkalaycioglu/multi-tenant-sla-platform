export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** SMTP vb. gonderim kanali. Basarisizlikta hata firlatir; kuyruk isi yeniden dener. */
export interface MailSender {
  send(message: MailMessage): Promise<{ messageId?: string }>;
}

/** Gonderilen her e-postanin denetim kaydi (`email_log`). */
export interface EmailLog {
  create(entry: {
    tenantId: string;
    ticketId: string | null;
    kind: string;
    recipient: string;
    subject: string;
  }): Promise<string>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
