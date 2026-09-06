/**
 * Notification delivery for triggered price alerts.
 *
 * Reuses the project's existing Nodemailer transport rather than adding another
 * channel. The template is Delta's own and speaks in the product's terms.
 */

import { currencyForSymbol, formatMoney } from '@/lib/market/currency';
import { transporter } from '@/lib/nodemailer';
import { ALERT_DIGEST_EMAIL_TEMPLATE, PRICE_ALERT_EMAIL_TEMPLATE } from '@/lib/nodemailer/templates';
import type { DigestSummary } from '@/lib/services/digest.service';
import type { StoredAlertEvent } from '@/lib/services/repositories';

export interface AlertRecipient {
  email: string;
  name?: string;
}

export async function sendPriceAlertNotification(
  recipient: AlertRecipient,
  event: StoredAlertEvent
): Promise<void> {
  if (!recipient?.email) throw new Error('No recipient email for this alert.');

  const directionLabel = event.direction === 'buy' ? 'Buy' : 'Sell';
  const currency = currencyForSymbol(event.symbol);
  const threshold = formatMoney(event.threshold, currency);
  const html = PRICE_ALERT_EMAIL_TEMPLATE
    .replace(/{{symbol}}/g, event.symbol)
    .replace(/{{company}}/g, event.company)
    .replace(/{{direction}}/g, directionLabel)
    .replace(/{{threshold}}/g, threshold)
    .replace(/{{price}}/g, formatMoney(event.triggeredPrice, currency))
    .replace(/{{message}}/g, event.message)
    .replace(
      /{{triggeredAt}}/g,
      event.triggeredAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    );

  await transporter.sendMail({
    from: `"Delta Alerts" <${process.env.NODEMAILER_EMAIL ?? 'alerts@delta.app'}>`,
    to: recipient.email,
    subject: `${event.symbol} hit your ${directionLabel.toLowerCase()} threshold of ${threshold}`,
    text: event.message,
    html,
  });
}

/**
 * The bundled digest for users who opted out of per-crossing emails.
 * One message covering everything that fired since their last digest.
 */
export async function sendAlertDigestNotification(
  recipient: AlertRecipient,
  summary: DigestSummary,
  since: Date
): Promise<void> {
  if (!recipient?.email) throw new Error('No recipient email for this digest.');

  const items = summary.lines
    .map(
      (line) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #e6ebf3;color:#4a5a72;font-size:14px;">${line}</td></tr>`
    )
    .join('');

  const html = ALERT_DIGEST_EMAIL_TEMPLATE
    .replace(/{{headline}}/g, summary.headline)
    .replace(/{{items}}/g, items)
    .replace(
      /{{since}}/g,
      since.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    );

  await transporter.sendMail({
    from: `"Delta Alerts" <${process.env.NODEMAILER_EMAIL ?? 'alerts@delta.app'}>`,
    to: recipient.email,
    subject: summary.headline,
    text: `${summary.headline}\n\n${summary.lines.join('\n')}`,
    html,
  });
}
