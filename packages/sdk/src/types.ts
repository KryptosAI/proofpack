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

export interface ProofEventPayload {
  userId: string;
  event: ProofEventType | string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  sessionId?: string;
}

export interface ProofEvent extends ProofEventPayload {
  id: string;
  timestamp: string;
}

export type ProofEventCallback = (events: ProofEvent[]) => void;
