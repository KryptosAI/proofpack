import { describe, it, expect } from 'vitest';
import { analyzeFraudRisk } from '../../packages/backend/src/fraud';
import { buildEvidence } from '../../packages/backend/src/evidence';
import { ProofEvent } from '../../packages/backend/src/types';

const makeEvent = (overrides: Partial<ProofEvent> = {}): ProofEvent => ({
  id: 'ev_1',
  merchant_id: 'm_1',
  user_id: 'user_1',
  event: 'user.signed_in',
  metadata: {},
  ip_address: '192.168.1.1',
  user_agent: 'Chrome/120',
  device_id: 'device_1',
  session_id: 'session_1',
  timestamp: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('Fraud Analysis', () => {
  it('returns low risk for consistent activity', () => {
    const events = [
      makeEvent({ event: 'user.signed_up', timestamp: '2024-01-01T00:00:00Z' }),
      makeEvent({ event: 'terms.accepted', timestamp: '2024-01-01T00:01:00Z' }),
      makeEvent({ event: 'subscription.started', timestamp: '2024-01-01T00:05:00Z' }),
      makeEvent({ event: 'payment.completed', timestamp: '2024-01-01T00:05:30Z' }),
      makeEvent({ event: 'user.signed_in', timestamp: '2024-01-05T00:00:00Z' }),
      makeEvent({ event: 'credits.consumed', timestamp: '2024-01-05T01:00:00Z' }),
      makeEvent({ event: 'output.generated', timestamp: '2024-01-05T01:01:00Z' }),
      makeEvent({ event: 'output.downloaded', timestamp: '2024-01-05T01:02:00Z' }),
    ];

    const result = analyzeFraudRisk(events);
    expect(result.risk).toBe('low');
    expect(result.score).toBeLessThan(25);
  });

  it('flags rapid IP changes as high risk', () => {
    const events: ProofEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent({
        id: `ev_${i}`,
        event: 'user.signed_in',
        ip_address: `203.0.113.${i}`,
        device_id: `device_${i}`,
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      }));
    }

    const result = analyzeFraudRisk(events);
    expect(result.flags.some((f) => f.type === 'ip_volatility')).toBe(true);
    expect(result.flags.some((f) => f.type === 'device_volatility')).toBe(true);
    expect(result.risk).not.toBe('low');
  });

  it('flags rapid signup-to-payment conversion', () => {
    const now = new Date();
    const events = [
      makeEvent({ event: 'user.signed_up', timestamp: now.toISOString() }),
      makeEvent({
        event: 'payment.completed',
        timestamp: new Date(now.getTime() + 60 * 1000).toISOString(),
      }),
    ];

    const result = analyzeFraudRisk(events);
    expect(result.flags.some((f) => f.type === 'rapid_conversion')).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(20);
  });
});

describe('Evidence Templates', () => {
  it('builds product_not_received evidence correctly', () => {
    const dispute = {
      id: 'd_1', merchant_id: 'm_1', stripe_dispute_id: 'dp_1',
      charge_id: 'ch_1', customer_id: 'cus_1', payment_intent_id: null,
      amount: 2900, currency: 'usd', reason: 'product_not_received',
      status: 'needs_response', evidence_submitted: 0, evidence_submitted_at: null,
      evidence_due_by: null, user_id: 'user_1', fraud_score: null,
      created_at: '', updated_at: '',
    };

    const events = [
      makeEvent({ event: 'user.signed_up', timestamp: '2024-01-01T00:00:00Z' }),
      makeEvent({ event: 'terms.accepted', timestamp: '2024-01-01T00:00:05Z', metadata: { version: 'v2' } }),
      makeEvent({ event: 'credits.consumed', timestamp: '2024-01-02T00:00:00Z', metadata: { credits: 50 } }),
      makeEvent({ event: 'output.generated', timestamp: '2024-01-02T00:00:01Z', metadata: { tokens: 1000 } }),
      makeEvent({ event: 'output.downloaded', timestamp: '2024-01-02T00:00:10Z', metadata: { format: 'pdf' } }),
    ];

    const result = buildEvidence(dispute, events);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.summary).toContain('product');
    expect(result.summary).toContain('delivered');
  });

  it('falls back to general template for unknown reasons', () => {
    const dispute = {
      id: 'd_1', merchant_id: 'm_1', stripe_dispute_id: 'dp_1',
      charge_id: 'ch_1', customer_id: 'cus_1', payment_intent_id: null,
      amount: 1000, currency: 'usd', reason: 'unknown_reason',
      status: 'needs_response', evidence_submitted: 0, evidence_submitted_at: null,
      evidence_due_by: null, user_id: 'user_1', fraud_score: null,
      created_at: '', updated_at: '',
    };

    const events: ProofEvent[] = [];
    const result = buildEvidence(dispute, events);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.summary).toContain('$10.00');
  });
});
