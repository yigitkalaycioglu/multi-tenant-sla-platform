/** Basit, e-posta istemcilerinde guvenli calisan HTML sablonu. */
export function renderTicketMail(params: {
  heading: string;
  intro: string;
  reference: string;
  title: string;
  priority: string;
  dueAt: string;
  accent: string;
  ctaUrl?: string;
}): { html: string; text: string } {
  const { heading, intro, reference, title, priority, dueAt, accent, ctaUrl } = params;

  const html = `<!doctype html>
<html lang="tr"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e6ec">
    <tr><td style="background:${accent};height:6px"></td></tr>
    <tr><td style="padding:24px 28px 8px">
      <h1 style="margin:0;font-size:18px;line-height:1.4">${escapeHtml(heading)}</h1>
      <p style="margin:8px 0 0;font-size:14px;color:#5b6472">${escapeHtml(intro)}</p>
    </td></tr>
    <tr><td style="padding:8px 28px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse">
        ${row('Bilet', `${escapeHtml(reference)} — ${escapeHtml(title)}`)}
        ${row('Oncelik', escapeHtml(priority))}
        ${row('SLA hedefi', escapeHtml(dueAt))}
      </table>
      ${
        ctaUrl
          ? `<p style="margin:20px 0 0"><a href="${ctaUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Bileti ac</a></p>`
          : ''
      }
    </td></tr>
  </table>
</body></html>`;

  const text = `${heading}\n\n${intro}\n\nBilet: ${reference} - ${title}\nOncelik: ${priority}\nSLA hedefi: ${dueAt}\n${ctaUrl ?? ''}`;

  return { html, text };
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#5b6472;width:110px;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-weight:600">${value}</td>
  </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
