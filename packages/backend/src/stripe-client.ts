import Stripe from 'stripe';
import { getDb } from './db';
import { Dispute } from './types';
import { buildEvidence } from './evidence';
import { ProofEvent } from './types';

export function getStripeClient(accessToken: string, merchantId: string): Stripe {
  return new Stripe(accessToken, {
    apiVersion: '2024-11-20.acacia',
    appInfo: {
      name: 'ProofPack',
      version: '1.0.0',
      url: 'https://proofpack.dev',
    },
  });
}

export async function submitEvidenceToStripe(
  dispute: Dispute,
  events: ProofEvent[]
): Promise<{ submitted: boolean; stripeEvidence?: Stripe.Dispute }> {
  const db = getDb();

  const connectRow = db.prepare(
    'SELECT access_token FROM connect_accounts WHERE merchant_id = ?'
  ).get(dispute.merchant_id) as { access_token: string } | undefined;

  const apiKey = connectRow?.access_token ?? process.env.STRIPE_SECRET_KEY;

  if (!apiKey) {
    console.log(`No Stripe API key available for merchant ${dispute.merchant_id}, skipping auto-submit`);
    return { submitted: false };
  }

  const stripe = getStripeClient(apiKey, dispute.merchant_id);
  const evidence = buildEvidence(dispute, events);

  const TEXT_FIELDS = new Set([
    'access_activity_log', 'product_description', 'service_date',
    'cancellation_policy_disclosure', 'cancellation_rebuttal',
    'customer_email_address', 'customer_name', 'customer_purchase_ip',
    'duplicate_charge_explanation', 'duplicate_charge_id',
    'refund_policy_disclosure', 'refund_refusal_explanation',
    'shipping_address', 'shipping_carrier', 'shipping_date',
    'shipping_tracking_number', 'uncategorized_text',
  ]);

  const evidenceMap: Record<string, string> = {};
  const uncategorizedParts: string[] = [];

  for (const section of evidence.sections) {
    if (TEXT_FIELDS.has(section.stripeField)) {
      if (evidenceMap[section.stripeField]) {
        evidenceMap[section.stripeField] += '\n\n' + section.content;
      } else {
        evidenceMap[section.stripeField] = section.content;
      }
    } else {
      uncategorizedParts.push(`=== ${section.section} ===\n${section.content}`);
    }
  }

  if (evidence.uncategorizedText) {
    uncategorizedParts.push(evidence.uncategorizedText);
  }

  evidenceMap.uncategorized_text = uncategorizedParts.join('\n\n');

  try {
    const updated = await stripe.disputes.update(dispute.stripe_dispute_id, {
      evidence: evidenceMap as any,
    });

    db.prepare(`
      UPDATE disputes SET evidence_submitted = 1, evidence_submitted_at = datetime('now'), status = ?
      WHERE id = ?
    `).run(updated.status, dispute.id);

    console.log(`Evidence submitted for dispute ${dispute.stripe_dispute_id}`);
    return { submitted: true, stripeEvidence: updated };
  } catch (err: any) {
    console.error(`Failed to submit evidence for ${dispute.stripe_dispute_id}:`, err.message);
    return { submitted: false };
  }
}

export async function fetchStripeDispute(
  merchantId: string,
  stripeDisputeId: string
): Promise<Stripe.Dispute | null> {
  const db = getDb();

  const connectRow = db.prepare(
    'SELECT access_token FROM connect_accounts WHERE merchant_id = ?'
  ).get(merchantId) as { access_token: string } | undefined;

  if (!connectRow) return null;

  const stripe = getStripeClient(connectRow.access_token, merchantId);
  try {
    return await stripe.disputes.retrieve(stripeDisputeId);
  } catch {
    return null;
  }
}

export async function fetchStripeCharge(
  merchantId: string,
  chargeId: string
): Promise<Stripe.Charge | null> {
  const db = getDb();

  const connectRow = db.prepare(
    'SELECT access_token FROM connect_accounts WHERE merchant_id = ?'
  ).get(merchantId) as { access_token: string } | undefined;

  if (!connectRow) return null;

  const stripe = getStripeClient(connectRow.access_token, merchantId);
  try {
    return await stripe.charges.retrieve(chargeId);
  } catch {
    return null;
  }
}
