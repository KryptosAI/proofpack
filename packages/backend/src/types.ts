export enum ProofEventType {
  USER_SIGNED_IN = 'user.signed_in',
  USER_SIGNED_UP = 'user.signed_up',
  TERMS_ACCEPTED = 'terms.accepted',
  SUBSCRIPTION_STARTED = 'subscription.started',
  SUBSCRIPTION_RENEWED = 'subscription.renewed',
  CREDITS_PURCHASED = 'credits.purchased',
  CREDITS_CONSUMED = 'credits.consumed',
  OUTPUT_GENERATED = 'output.generated',
  OUTPUT_DOWNLOADED = 'output.downloaded',
  OUTPUT_EXPORTED = 'output.exported',
  API_KEY_USED = 'apikey.used',
  PAYMENT_COMPLETED = 'payment.completed',
  INVOICE_VIEWED = 'invoice.viewed',
  FEATURE_USED = 'feature.used',
}

export interface ProofEvent {
  id: string;
  merchant_id: string;
  user_id: string;
  event: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  device_id: string | null;
  session_id: string | null;
  timestamp: string;
  created_at: string;
}

export interface Dispute {
  id: string;
  merchant_id: string;
  stripe_dispute_id: string;
  charge_id: string;
  customer_id: string;
  payment_intent_id: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  evidence_submitted: number;
  evidence_submitted_at: string | null;
  evidence_due_by: string | null;
  user_id: string | null;
  fraud_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventRequest {
  events: {
    userId: string;
    event: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
    sessionId?: string;
    id: string;
    timestamp: string;
  }[];
}

export interface FraudAnalysis {
  score: number;
  flags: FraudFlag[];
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface FraudFlag {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface TimelineEntry {
  label: string;
  icon: string;
  events: {
    title: string;
    items: string[];
  };
}

export interface EvidencePacketData {
  disputeId: string;
  chargeId: string;
  customerId: string;
  amount: number;
  currency: string;
  reason: string;
  timeline: TimelineEntry[];
  summary: string;
  deviceFingerprint: string;
  eventCount: number;
  dateRange: string;
  fraudAnalysis?: FraudAnalysis;
  recommendation?: string;
}
