import { getDb } from './db';
import { Dispute, FraudAnalysis } from './types';

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook';
  config: Record<string, string>;
}

export interface AlertPayload {
  event: string;
  merchantId: string;
  dispute?: Dispute;
  fraudAnalysis?: FraudAnalysis;
  timestamp: string;
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  const db = getDb();

  const configs = db.prepare(`
    SELECT * FROM alert_configs
    WHERE merchant_id = ? AND active = 1 AND events LIKE ?
  `).all(payload.merchantId, `%${payload.event}%`) as any[];

  for (const cfg of configs) {
    const channel: AlertChannel = {
      type: cfg.channel as AlertChannel['type'],
      config: JSON.parse(cfg.config),
    };

    switch (channel.type) {
      case 'email':
        await sendEmail(payload, channel.config);
        break;
      case 'slack':
        await sendSlack(payload, channel.config);
        break;
      case 'webhook':
        await sendWebhook(payload, channel.config);
        break;
    }
  }
}

async function sendEmail(
  payload: AlertPayload,
  config: Record<string, string>
): Promise<void> {
  const { to, from } = config;
  if (!to) return;

  const subject = buildSubject(payload);
  const body = buildEmailBody(payload);

  if (process.env.SENDGRID_API_KEY) {
    const sg = require('@sendgrid/mail');
    sg.setApiKey(process.env.SENDGRID_API_KEY);
    try {
      await sg.send({ to, from: from ?? to, subject, text: body });
      console.log(`Alert email sent to ${to}`);
    } catch (err) {
      console.error('Failed to send email:', err);
    }
  } else {
    console.log(`[EMAIL TO ${to}] ${subject}\n${body}`);
  }
}

async function sendSlack(
  payload: AlertPayload,
  config: Record<string, string>
): Promise<void> {
  const webhookUrl = config.webhook_url;
  if (!webhookUrl) return;

  const blocks = buildSlackBlocks(payload);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    console.log('Slack notification sent');
  } catch (err) {
    console.error('Failed to send Slack notification:', err);
  }
}

async function sendWebhook(
  payload: AlertPayload,
  config: Record<string, string>
): Promise<void> {
  const url = config.url;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('Webhook notification sent');
  } catch (err) {
    console.error('Failed to send webhook:', err);
  }
}

function buildSubject(payload: AlertPayload): string {
  if (payload.dispute) {
    const amt = (payload.dispute.amount / 100).toFixed(2);
    return `[ProofPack] New Dispute: $${amt} — ${payload.dispute.reason}`;
  }
  return `[ProofPack] ${payload.event}`;
}

function buildEmailBody(payload: AlertPayload): string {
  const lines: string[] = [];
  lines.push(`Event: ${payload.event}`);
  lines.push(`Time: ${payload.timestamp}`);

  if (payload.dispute) {
    const d = payload.dispute;
    lines.push('');
    lines.push('=== DISPUTE DETAILS ===');
    lines.push(`Dispute ID: ${d.stripe_dispute_id}`);
    lines.push(`Charge ID: ${d.charge_id}`);
    lines.push(`Amount: $${(d.amount / 100).toFixed(2)} ${d.currency.toUpperCase()}`);
    lines.push(`Reason: ${d.reason}`);
    lines.push(`Status: ${d.status}`);
    if (d.evidence_due_by) {
      lines.push(`Evidence Due: ${new Date(d.evidence_due_by).toLocaleDateString()}`);
    }
  }

  if (payload.fraudAnalysis) {
    const fa = payload.fraudAnalysis;
    lines.push('');
    lines.push('=== FRAUD ANALYSIS ===');
    lines.push(`Risk Level: ${fa.risk.toUpperCase()}`);
    lines.push(`Fraud Score: ${fa.score}/100`);
    lines.push(`Recommendation: ${fa.recommendation}`);
  }

  lines.push('');
  lines.push('View in ProofPack Dashboard');
  return lines.join('\n');
}

function buildSlackBlocks(payload: AlertPayload): any[] {
  const blocks: any[] = [];

  if (payload.dispute) {
    const d = payload.dispute;
    const amt = (d.amount / 100).toFixed(2);

    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: `🚨 New Dispute: $${amt} ${d.currency.toUpperCase()}` },
    });
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Charge:* \`${d.charge_id}\`` },
        { type: 'mrkdwn', text: `*Reason:* ${(d.reason ?? '').replace(/_/g, ' ')}` },
        { type: 'mrkdwn', text: `*Customer:* \`${d.customer_id}\`` },
        { type: 'mrkdwn', text: `*Status:* ${d.status.replace(/_/g, ' ')}` },
      ],
    });

    if (d.evidence_due_by) {
      const due = new Date(d.evidence_due_by);
      const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86400000);
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `⏰ Evidence due *${due.toLocaleDateString()}* (${daysLeft} days left)` },
      });
    }

    if (payload.fraudAnalysis) {
      const fa = payload.fraudAnalysis;
      const emoji = fa.risk === 'high' ? '🔴' : fa.risk === 'medium' ? '🟡' : '🟢';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji} *Fraud Risk: ${fa.risk.toUpperCase()}* (${fa.score}/100)\n${fa.recommendation}` },
      });
    }
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `Event: ${payload.event}\nTime: ${payload.timestamp}` },
    });
  }

  return blocks;
}
