import { ProofEvent, TimelineEntry } from './types';

const EVENT_GROUPS: Record<string, { title: string; icon: string }> = {
  'user.signed_up': { title: 'Account Created', icon: '👤' },
  'user.signed_in': { title: 'Sign-In Activity', icon: '🔑' },
  'terms.accepted': { title: 'Terms & Policies Accepted', icon: '📋' },
  'subscription.started': { title: 'Subscription Started', icon: '💳' },
  'subscription.renewed': { title: 'Subscription Renewed', icon: '🔄' },
  'credits.purchased': { title: 'Credits Purchased', icon: '💰' },
  'credits.consumed': { title: 'Credits / Tokens Consumed', icon: '⚡' },
  'output.generated': { title: 'AI Outputs Generated', icon: '🤖' },
  'output.downloaded': { title: 'Outputs Downloaded', icon: '📥' },
  'output.exported': { title: 'Outputs Exported', icon: '📤' },
  'payment.completed': { title: 'Payments Completed', icon: '✅' },
  'invoice.viewed': { title: 'Invoices Viewed', icon: '🧾' },
  'feature.used': { title: 'Features Used', icon: '🔧' },
  'apikey.used': { title: 'API Key Usage', icon: '🔌' },
};

export function buildTimeline(events: ProofEvent[]): TimelineEntry[] {
  const grouped = new Map<string, ProofEvent[]>();

  for (const ev of events) {
    const key = ev.event;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ev);
  }

  const timeline: TimelineEntry[] = [];

  for (const [eventType, evs] of grouped) {
    const config = EVENT_GROUPS[eventType] ?? {
      title: eventType.replace('.', ' - ').replace(/_/g, ' '),
      icon: '📌',
    };

    timeline.push({
      label: config.title,
      icon: config.icon,
      events: {
        title: config.title,
        items: evs.map((e) => {
          const time = new Date(e.timestamp).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          const meta = formatMetadata(e.metadata);
          return `[${time}] ${meta ? `${meta}` : 'Event recorded'}`;
        }),
      },
    });
  }

  return timeline;
}

function formatMetadata(meta: Record<string, unknown> | null): string {
  if (!meta || Object.keys(meta).length === 0) return '';

  const displayKeys: Record<string, string> = {
    credits: 'credits', tokens: 'tokens', model: 'model',
    output_id: 'output', file: 'file', plan: 'plan',
    amount: 'amount', invoice_id: 'invoice', feature: 'feature',
    endpoint: 'endpoint', ip: 'IP', email: 'email', device: 'device',
  };

  const parts: string[] = [];
  for (const [key, val] of Object.entries(meta)) {
    const label = displayKeys[key] ?? key;
    parts.push(`${label}=${val}`);
  }

  return parts.join(', ');
}
