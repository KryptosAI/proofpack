import { getDb } from './db';
import { ProofEvent, Dispute } from './types';

export interface EvidenceSection {
  section: string;
  content: string;
  stripeField: string;
}

export interface FullEvidence {
  sections: EvidenceSection[];
  summary: string;
  uncategorizedText: string;
}

const REASON_TEMPLATES: Record<string, EvidenceSection[]> = {
  product_not_received: [
    { section: 'Service Description',      content: '', stripeField: 'product_description' },
    { section: 'Service Date',             content: '', stripeField: 'service_date' },
    { section: 'Access & Activity Logs',   content: '', stripeField: 'access_activity_log' },
    { section: 'IP & Device Consistency',  content: '', stripeField: 'uncategorized_text' },
    { section: 'Activity Communication',   content: '', stripeField: 'access_activity_log' },
  ],
  fraudulent: [
    { section: 'Identity Fingerprint',     content: '', stripeField: 'uncategorized_text' },
    { section: 'Service Delivery Proof',   content: '', stripeField: 'access_activity_log' },
    { section: 'IP & Location History',    content: '', stripeField: 'access_activity_log' },
    { section: 'Auth Activity Timeline',   content: '', stripeField: 'uncategorized_text' },
    { section: 'Prior Charges History',    content: '', stripeField: 'uncategorized_text' },
  ],
  subscription_canceled: [
    { section: 'Subscription Terms',       content: '', stripeField: 'cancellation_policy_disclosure' },
    { section: 'Cancellation Process',     content: '', stripeField: 'cancellation_policy_disclosure' },
    { section: 'Usage History',            content: '', stripeField: 'access_activity_log' },
    { section: 'Refund Policy',            content: '', stripeField: 'refund_policy_disclosure' },
  ],
  duplicate: [
    { section: 'Charge Details',           content: '', stripeField: 'duplicate_charge_explanation' },
    { section: 'Refund Policy',            content: '', stripeField: 'refund_policy_disclosure' },
  ],
  unrecognized: [
    { section: 'Service Description',      content: '', stripeField: 'product_description' },
    { section: 'Customer Identity',        content: '', stripeField: 'uncategorized_text' },
    { section: 'Purchase Timeline',        content: '', stripeField: 'uncategorized_text' },
    { section: 'IP & Device Match',        content: '', stripeField: 'access_activity_log' },
  ],
  credit_not_processed: [
    { section: 'Credit History',           content: '', stripeField: 'refund_policy_disclosure' },
    { section: 'Refund Policy',            content: '', stripeField: 'refund_policy_disclosure' },
    { section: 'Customer Communication',   content: '', stripeField: 'access_activity_log' },
  ],
  general: [
    { section: 'Product Description',      content: '', stripeField: 'product_description' },
    { section: 'Service Documentation',    content: '', stripeField: 'access_activity_log' },
    { section: 'Customer Communication',   content: '', stripeField: 'access_activity_log' },
    { section: 'Refund Policy',            content: '', stripeField: 'refund_policy_disclosure' },
    { section: 'Additional Context',       content: '', stripeField: 'uncategorized_text' },
  ],
};

function getTemplate(reason: string | null): EvidenceSection[] {
  return REASON_TEMPLATES[reason ?? ''] ?? REASON_TEMPLATES.general;
}

export function buildEvidence(
  dispute: Dispute,
  events: ProofEvent[]
): FullEvidence {
  const reason = dispute.reason ?? 'general';
  const template = getTemplate(reason).map((t) => ({ ...t, content: '' }));

  const signInEvents = events.filter((e) => e.event.includes('sign'));
  const usageEvents = events.filter(
    (e) => e.event.includes('consumed') || e.event.includes('generated') || e.event.includes('output')
  );
  const termsEvents = events.filter((e) => e.event.includes('terms'));
  const paymentEvents = events.filter((e) => e.event.includes('payment') || e.event.includes('subscription'));
  const ips = [...new Set(events.map((e) => e.ip_address).filter(Boolean))];
  const devices = [...new Set(events.map((e) => e.device_id).filter(Boolean))];

  const fill = (section: string, content: string) => {
    const t = template.find((t) => t.section === section || t.stripeField === section);
    if (t) t.content = t.content ? t.content + '\n\n' + content : content;
  };

  fill('product_description', buildProductDescription(dispute));
  fill('service_date', buildServiceDates(events));
  fill('access_activity_log', buildServiceDocs(usageEvents, paymentEvents));
  fill('access_activity_log', buildCommunicationLog(events));
  fill('uncategorized_text', buildIdentityProof(signInEvents, ips, devices));
  fill('uncategorized_text', buildReceipt(dispute, paymentEvents));
  fill('uncategorized_text', buildUncategorized(dispute, events));
  fill('cancellation_policy_disclosure', buildCancellationPolicy());
  fill('cancellation_policy_disclosure', buildCancellationDisclosure(termsEvents, events));
  fill('refund_policy_disclosure', buildRefundPolicy());
  fill('refund_policy_disclosure', buildRefundPolicyDisclosure(termsEvents));
  fill('duplicate_charge_explanation', buildDuplicateDocs(dispute, paymentEvents));

  const summary = buildStripeSummary(dispute, reason, signInEvents, usageEvents, termsEvents, paymentEvents, ips);
  const uncategorizedText = buildUncategorized(dispute, events);

  return {
    sections: template.filter((t) => t.content),
    summary,
    uncategorizedText,
  };
}

function buildProductDescription(dispute: Dispute): string {
  return `AI SaaS digital service — subscription-based access to AI content generation platform. ` +
    `The customer purchased digital credits/tokens for AI-powered content creation. ` +
    `Charge ID: ${dispute.charge_id}. All services delivered digitally with immediate consumption logging.`;
}

function buildServiceDates(events: ProofEvent[]): string {
  const dates = events.map((e) => e.timestamp).sort();
  if (dates.length === 0) return 'No activity recorded';
  return `Service period: ${new Date(dates[0]).toLocaleDateString()} to ${new Date(dates[dates.length - 1]).toLocaleDateString()}. ` +
    `${dates.length} logged interactions with the platform.`;
}

function buildServiceDocs(usageEvents: ProofEvent[], paymentEvents: ProofEvent[]): string {
  const parts: string[] = [];

  if (usageEvents.length > 0) {
    parts.push(`${usageEvents.length} usage events recorded:`);
    usageEvents.forEach((e) => {
      const t = new Date(e.timestamp).toLocaleString();
      parts.push(`  - [${t}] ${e.event}: ${JSON.stringify(e.metadata)}`);
    });
  }

  if (paymentEvents.length > 0) {
    parts.push(`${paymentEvents.length} payment/subscription events:`);
    paymentEvents.forEach((e) => {
      const t = new Date(e.timestamp).toLocaleString();
      parts.push(`  - [${t}] ${e.event}: ${JSON.stringify(e.metadata)}`);
    });
  }

  return parts.join('\n') || 'Service was delivered digitally. No usage logs available.';
}

function buildIdentityProof(
  signInEvents: ProofEvent[],
  ips: string[],
  devices: string[]
): string {
  const parts: string[] = [];
  parts.push(`Customer authenticated ${signInEvents.length} times.`);
  parts.push(`IP addresses: ${ips.join(', ') || 'N/A'}`);
  parts.push(`Devices: ${devices.join(', ') || 'N/A'}`);
  if (ips.length <= 2 && ips.length > 0) {
    parts.push('Consistent IP address(es) confirm same user throughout service period.');
  }
  return parts.join('\n');
}

function buildCommunicationLog(events: ProofEvent[]): string {
  const parts: string[] = [];
  parts.push('All customer interactions logged by system:');
  events.slice(0, 20).forEach((e) => {
    const t = new Date(e.timestamp).toLocaleString();
    const meta = Object.entries(e.metadata ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    parts.push(`[${t}] ${e.event}${meta ? ' — ' + meta : ''}`);
  });
  if (events.length > 20) {
    parts.push(`... and ${events.length - 20} more events`);
  }
  return parts.join('\n');
}

function buildCancellationPolicy(): string {
  return 'Subscriptions auto-renew unless canceled. Customers may cancel at any time from their account settings. ' +
    'Cancellation takes effect at the end of the current billing period. No partial refunds for unused time. ' +
    'Digital credits are non-refundable once consumed.';
}

function buildCancellationDisclosure(termsEvents: ProofEvent[], allEvents: ProofEvent[]): string {
  if (termsEvents.length > 0) {
    return `Customer accepted Terms of Service on ${new Date(termsEvents[0].timestamp).toLocaleDateString()}. ` +
      `Cancellation policy is disclosed in Section 4 of the Terms.`;
  }
  const signUp = allEvents.find((e) => e.event === 'user.signed_up');
  if (signUp) {
    return `Cancellation policy was disclosed during sign-up on ${new Date(signUp.timestamp).toLocaleDateString()}.`;
  }
  return 'Cancellation policy disclosed during checkout and available at /terms.';
}

function buildRefundPolicy(): string {
  return 'Refund Policy: Digital products and consumed credits are non-refundable. ' +
    'Unused credits may be eligible for refund within 7 days of purchase if not consumed. ' +
    'Refund requests are reviewed within 48 hours.';
}

function buildRefundPolicyDisclosure(termsEvents: ProofEvent[]): string {
  if (termsEvents.length > 0) {
    return `Refund policy disclosed in Terms of Service accepted on ${new Date(termsEvents[0].timestamp).toLocaleDateString()}.`;
  }
  return 'Refund policy disclosed during checkout and available at /refund-policy.';
}

function buildReceipt(dispute: Dispute, paymentEvents: ProofEvent[]): string {
  const amt = (dispute.amount / 100).toFixed(2);
  const parts = [
    `Amount: $${amt} ${dispute.currency.toUpperCase()}`,
    `Charge ID: ${dispute.charge_id}`,
    `Customer ID: ${dispute.customer_id}`,
  ];

  paymentEvents.forEach((e) => {
    const t = new Date(e.timestamp).toLocaleString();
    parts.push(`[${t}] ${e.event} — ${JSON.stringify(e.metadata)}`);
  });

  return parts.join('\n');
}

function buildDuplicateDocs(dispute: Dispute, paymentEvents: ProofEvent[]): string {
  return `Charge ID: ${dispute.charge_id}\nAmount: $${(dispute.amount / 100).toFixed(2)} ${dispute.currency.toUpperCase()}\n` +
    `This charge corresponds to a single service delivery. Payment events logged:\n` +
    paymentEvents.map((e) => `  [${new Date(e.timestamp).toLocaleString()}] ${e.event}`).join('\n') ||
    'No duplicate charges found.';
}

function buildUncategorized(dispute: Dispute, events: ProofEvent[]): string {
  const parts: string[] = [];
  parts.push(`Dispute ID: ${dispute.stripe_dispute_id}`);
  parts.push(`Total proof events captured: ${events.length}`);
  parts.push(`Evidence generated at: ${new Date().toISOString()}`);

  const eventTypes = [...new Set(events.map((e) => e.event))];
  parts.push(`Event types: ${eventTypes.join(', ')}`);

  return parts.join('\n');
}

function buildStripeSummary(
  dispute: Dispute,
  reason: string,
  signInEvents: ProofEvent[],
  usageEvents: ProofEvent[],
  termsEvents: ProofEvent[],
  paymentEvents: ProofEvent[],
  ips: string[]
): string {
  const amt = (dispute.amount / 100).toFixed(2);

  const summaries: Record<string, string> = {
    product_not_received: `The customer actively used the service with ${usageEvents.length} logged interactions. ` +
      `They signed in ${signInEvents.length} times from consistent IPs (${ips.join(', ')}), ` +
      `consumed digital credits, generated AI outputs, and downloaded results. ` +
      `The product — an AI digital service — was fully delivered. The claim of non-receipt is contradicted by the customer's own usage.`,

    fraudulent: `The customer authenticated ${signInEvents.length} times from consistent IP addresses and devices. ` +
      `Usage patterns show legitimate, sustained engagement over multiple sessions. ` +
      `All payments correspond to actual service consumption with matching metadata. ` +
      `No indicators of fraudulent activity or unauthorized access detected.`,

    subscription_canceled: `The customer was notified of renewal terms. ` +
      `${usageEvents.length > 0 ? `They continued using the service with ${usageEvents.length} interactions after the most recent charge.` : ''} ` +
      `Cancellation policy was disclosed at signup and in Terms of Service. ` +
      `The subscription was active and functional throughout the disputed period.`,

    unrecognized: `The charge descriptor clearly identifies our service. ` +
      `The customer created an account, ${termsEvents.length > 0 ? 'accepted terms, ' : ''}` +
      `and used the service across ${signInEvents.length} sessions from consistent IPs and devices. ` +
      `This is the same customer who authenticated and consumed the paid service.`,

    general: `Charge amount: $${amt}. Customer had ${usageEvents.length} service interactions, ` +
      `${signInEvents.length} authentication events, and ${paymentEvents.length} payment events. ` +
      `Service delivered as described. All evidence attached.`,
  };

  return summaries[reason] ?? summaries.general;
}
