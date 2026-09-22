import { EmailAPIError, sendLovableEmail } from 'npm:@lovable.dev/email-js@0.1.0'

// Server-only shared mailer. All app emails go through here so no function
// talks to an external mail provider directly.

const SITE_NAME = 'legendflow'
// Verified sender subdomain delegated to Lovable's nameservers.
const SENDER_DOMAIN = 'notify.legendflow.tw'
// Domain shown in the From: header (cosmetic).
const FROM_DOMAIN = 'legendflow.tw'

export const MAIL_FROM = `${SITE_NAME} <noreply@${FROM_DOMAIN}>`

export type SendAppEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' }

export interface SendAppEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  /** Short label for delivery logs, e.g. 'renewal-reminder'. */
  label?: string
  /** Derive from the triggering event id so retries do not duplicate sends. */
  idempotencyKey?: string
  replyTo?: string
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Sends one app email through Lovable's managed email API.
 * A suppressed recipient is an expected outcome ({ sent: false }); every other
 * failure throws so callers can record it as failed on their own channel.
 */
export async function sendAppEmail(options: SendAppEmailOptions): Promise<SendAppEmailResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY is not configured')
  }
  if (!options.to) {
    throw new Error('recipient is required')
  }

  try {
    await sendLovableEmail(
      {
        to: options.to,
        from: MAIL_FROM,
        sender_domain: SENDER_DOMAIN,
        subject: options.subject,
        html: options.html,
        text: options.text ?? htmlToPlainText(options.html),
        purpose: 'transactional',
        label: options.label,
        idempotency_key: options.idempotencyKey || crypto.randomUUID(),
        reply_to: options.replyTo,
      },
      { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') },
    )
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === 'recipient_suppressed') {
      return { sent: false, reason: 'recipient_suppressed' }
    }
    throw error
  }

  return { sent: true }
}
