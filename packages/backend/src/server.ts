import { config as loadEnv } from 'dotenv';
import { resolve as pathResolve } from 'path';
loadEnv({ path: pathResolve(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { requireAuth, requireConnect } from './auth';
import { getConnectAuthUrl, handleConnectCallback } from './connect';
import { buildEvidence } from './evidence';
import { buildTimeline } from './evidence-timeline';
import { generateEvidencePdf } from './pdf';
import { analyzeFraudRisk } from './fraud';
import { sendAlert } from './alerts';
import { submitEvidenceToStripe, fetchStripeDispute } from './stripe-client';
import Stripe from 'stripe';
import { ProofEvent, Dispute, CreateEventRequest } from './types';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.static(pathResolve(__dirname, '..', 'public')));
app.use(express.json());

// ═══════════════════════════════════════════
//  MERCHANT & API KEY MANAGEMENT
// ═══════════════════════════════════════════

app.post('/api/merchants', async (req, res) => {
  const db = getDb();
  const { name, email } = req.body as { name: string; email: string };

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email required' });
  }

  const id = uuid();
  const apiKey = `ppk_${uuid().replace(/-/g, '')}`;

  db.prepare('INSERT INTO merchants (id, name, email) VALUES (?, ?, ?)').run(id, name, email);
  db.prepare('INSERT INTO api_keys (key, merchant_id, name) VALUES (?, ?, ?)').run(apiKey, id, 'Default');

  res.json({ merchantId: id, apiKey, name, email });
});

app.get('/api/merchant', requireAuth, (req, res) => {
  const db = getDb();
  const merchant = db.prepare(
    'SELECT m.*, ca.stripe_user_id, ca.livemode FROM merchants m LEFT JOIN connect_accounts ca ON ca.merchant_id = m.id WHERE m.id = ?'
  ).get(req.auth.merchantId);

  const apiKeys = db.prepare(
    'SELECT key, name, scopes, last_used_at, created_at, active FROM api_keys WHERE merchant_id = ?'
  ).all(req.auth.merchantId);

  res.json({ merchant, apiKeys });
});

app.post('/api/merchant/api-keys', requireAuth, (req, res) => {
  const db = getDb();
  const { name } = req.body as { name: string };

  const key = `ppk_${uuid().replace(/-/g, '')}`;
  db.prepare('INSERT INTO api_keys (key, merchant_id, name) VALUES (?, ?, ?)').run(key, req.auth.merchantId, name ?? 'Custom');

  res.json({ key, name: name ?? 'Custom' });
});

app.delete('/api/merchant/api-keys/:key', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE api_keys SET active = 0 WHERE key = ? AND merchant_id = ?').run(
    req.params.key, req.auth.merchantId
  );
  res.json({ revoked: true });
});

// ═══════════════════════════════════════════
//  STRIPE CONNECT OAUTH
// ═══════════════════════════════════════════

app.get('/api/connect/authorize', requireAuth, async (req, res) => {
  const result = await getConnectAuthUrl(req.auth.merchantId);
  res.json(result);
});

app.get('/api/connect/callback', async (req, res) => {
  const { code, state } = req.query as { code: string; state: string };

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  const result = await handleConnectCallback(code);

  if (!result) {
    return res.status(400).json({ error: 'Failed to connect Stripe account' });
  }

  res.redirect(`${process.env.APP_BASE_URL ?? 'http://localhost:5173'}/settings?connected=true`);
});

app.get('/api/connect/status', requireAuth, (req, res) => {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connect_accounts WHERE merchant_id = ?').get(req.auth.merchantId);
  res.json({ connected: !!conn, account: conn ?? null });
});

app.delete('/api/connect/disconnect', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM connect_accounts WHERE merchant_id = ?').run(req.auth.merchantId);
  db.prepare('UPDATE merchants SET stripe_account_id = NULL, connected_at = NULL WHERE id = ?').run(req.auth.merchantId);
  res.json({ disconnected: true });
});

// ═══════════════════════════════════════════
//  PROOF EVENTS (SDK INGESTION)
// ═══════════════════════════════════════════

app.post('/api/events', requireAuth, (req, res) => {
  const db = getDb();
  const { events } = req.body as CreateEventRequest;

  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events array is required' });
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO proof_events (id, merchant_id, user_id, event, metadata, ip_address, user_agent, device_id, session_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const ev of events) {
      insert.run(
        ev.id,
        req.auth.merchantId,
        ev.userId,
        ev.event,
        JSON.stringify(ev.metadata ?? {}),
        ev.ipAddress ?? null,
        ev.userAgent ?? null,
        ev.deviceId ?? null,
        ev.sessionId ?? null,
        ev.timestamp
      );
    }
  });

  tx();
  res.json({ received: events.length });
});

// ═══════════════════════════════════════════
//  DISPUTES
// ═══════════════════════════════════════════

app.get('/api/disputes', requireAuth, (req, res) => {
  const db = getDb();
  const disputes = db
    .prepare('SELECT * FROM disputes WHERE merchant_id = ? ORDER BY created_at DESC')
    .all(req.auth.merchantId);

  res.json({ disputes });
});

app.get('/api/disputes/:id', requireAuth, (req, res) => {
  const db = getDb();

  const dispute = db
    .prepare('SELECT * FROM disputes WHERE id = ? AND merchant_id = ?')
    .get(req.params.id, req.auth.merchantId) as Dispute | undefined;

  if (!dispute) {
    return res.status(404).json({ error: 'Dispute not found' });
  }

  const rawEvents = db
    .prepare(
      'SELECT * FROM proof_events WHERE merchant_id = ? AND user_id = ? ORDER BY timestamp ASC'
    )
    .all(req.auth.merchantId, dispute.user_id ?? dispute.customer_id) as ProofEvent[];

  const events = rawEvents.map((e) => ({
    ...e,
    metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata,
  }));

  const timeline = buildTimeline(events);
  const fraudAnalysis = analyzeFraudRisk(events);
  const evidence = buildEvidence(dispute, events);

  res.json({
    dispute,
    events,
    timeline,
    evidence,
    fraudAnalysis,
    eventCount: events.length,
  });
});

// ═══════════════════════════════════════════
//  FRAUD ANALYSIS
// ═══════════════════════════════════════════

app.get('/api/disputes/:id/fraud', requireAuth, (req, res) => {
  const db = getDb();

  const dispute = db
    .prepare('SELECT * FROM disputes WHERE id = ? AND merchant_id = ?')
    .get(req.params.id, req.auth.merchantId) as Dispute | undefined;

  if (!dispute) {
    return res.status(404).json({ error: 'Dispute not found' });
  }

  const rawEvents = db
    .prepare(
      'SELECT * FROM proof_events WHERE merchant_id = ? AND user_id = ? ORDER BY timestamp ASC'
    )
    .all(req.auth.merchantId, dispute.user_id ?? dispute.customer_id) as ProofEvent[];

  const events = rawEvents.map((e) => ({
    ...e,
    metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata,
  }));

  const analysis = analyzeFraudRisk(events);

  db.prepare('UPDATE disputes SET fraud_score = ? WHERE id = ?').run(analysis.score, dispute.id);

  res.json(analysis);
});

// ═══════════════════════════════════════════
//  PDF GENERATION
// ═══════════════════════════════════════════

app.get('/api/disputes/:id/pdf', requireAuth, (req, res) => {
  const db = getDb();

  const dispute = db
    .prepare('SELECT * FROM disputes WHERE id = ? AND merchant_id = ?')
    .get(req.params.id, req.auth.merchantId) as Dispute | undefined;

  if (!dispute) {
    return res.status(404).json({ error: 'Dispute not found' });
  }

  const rawEvents = db
    .prepare(
      'SELECT * FROM proof_events WHERE merchant_id = ? AND user_id = ? ORDER BY timestamp ASC'
    )
    .all(req.auth.merchantId, dispute.user_id ?? dispute.customer_id) as ProofEvent[];

  const events = rawEvents.map((e) => ({
    ...e,
    metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata,
  }));

  const timeline = buildTimeline(events);
  const evidence = buildEvidence(dispute, events);
  const fraudAnalysis = analyzeFraudRisk(events);

  const dates = events.map((e) => e.timestamp).sort();
  const dateRange =
    dates.length > 0
      ? `${new Date(dates[0]).toLocaleDateString()} — ${new Date(dates[dates.length - 1]).toLocaleDateString()}`
      : 'N/A';

  const ips = [...new Set(events.map((e) => e.ip_address).filter(Boolean))];
  const agents = [...new Set(events.map((e) => e.user_agent).filter(Boolean))];
  const devices = [...new Set(events.map((e) => e.device_id).filter(Boolean))];
  const sessions = [...new Set(events.map((e) => e.session_id).filter(Boolean))];
  const deviceFingerprint = buildDeviceFingerprint(ips, agents, devices, sessions);

  const pdf = generateEvidencePdf({
    disputeId: dispute.stripe_dispute_id,
    chargeId: dispute.charge_id,
    customerId: dispute.customer_id,
    amount: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason ?? 'general',
    timeline,
    summary: evidence.summary,
    deviceFingerprint,
    eventCount: events.length,
    dateRange,
    fraudAnalysis,
    recommendation: fraudAnalysis.recommendation,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="dispute-evidence-${dispute.stripe_dispute_id}.pdf"`
  );

  pdf.pipe(res);
  pdf.end();
});

// ═══════════════════════════════════════════
//  SUBMIT EVIDENCE TO STRIPE
// ═══════════════════════════════════════════

app.post('/api/disputes/:id/submit', requireAuth, async (req, res) => {
  const db = getDb();

  const dispute = db
    .prepare('SELECT * FROM disputes WHERE id = ? AND merchant_id = ?')
    .get(req.params.id, req.auth.merchantId) as Dispute | undefined;

  if (!dispute) {
    return res.status(404).json({ error: 'Dispute not found' });
  }

  const rawEvents = db
    .prepare(
      'SELECT * FROM proof_events WHERE merchant_id = ? AND user_id = ? ORDER BY timestamp ASC'
    )
    .all(req.auth.merchantId, dispute.user_id ?? dispute.customer_id) as ProofEvent[];

  const events = rawEvents.map((e) => ({
    ...e,
    metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata,
  }));

  const result = await submitEvidenceToStripe(dispute, events);

  if (result.submitted) {
    sendAlert({
      event: 'dispute.evidence_submitted',
      merchantId: req.auth.merchantId,
      dispute: { ...dispute, evidence_submitted: 1, evidence_submitted_at: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    });
  }

  res.json(result);
});

// ═══════════════════════════════════════════
//  ALERT CONFIGURATION
// ═══════════════════════════════════════════

app.get('/api/alerts', requireAuth, (req, res) => {
  const db = getDb();
  const configs = db.prepare(
    'SELECT * FROM alert_configs WHERE merchant_id = ? ORDER BY created_at DESC'
  ).all(req.auth.merchantId);

  res.json({ configs });
});

app.post('/api/alerts', requireAuth, (req, res) => {
  const db = getDb();
  const { alert_type, channel, config, events } = req.body as {
    alert_type: string;
    channel: string;
    config: Record<string, string>;
    events?: string[];
  };

  if (!alert_type || !channel || !config) {
    return res.status(400).json({ error: 'alert_type, channel, and config required' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO alert_configs (id, merchant_id, alert_type, channel, config, events)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.auth.merchantId, alert_type, channel, JSON.stringify(config), JSON.stringify(events ?? ['charge.dispute.created']));

  res.json({ id, alert_type, channel });
});

app.put('/api/alerts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { active, config, events } = req.body as {
    active?: number;
    config?: Record<string, string>;
    events?: string[];
  };

  if (active !== undefined) {
    db.prepare('UPDATE alert_configs SET active = ? WHERE id = ? AND merchant_id = ?').run(active, req.params.id, req.auth.merchantId);
  }
  if (config) {
    db.prepare('UPDATE alert_configs SET config = ? WHERE id = ? AND merchant_id = ?').run(JSON.stringify(config), req.params.id, req.auth.merchantId);
  }
  if (events) {
    db.prepare('UPDATE alert_configs SET events = ? WHERE id = ? AND merchant_id = ?').run(JSON.stringify(events), req.params.id, req.auth.merchantId);
  }

  res.json({ updated: true });
});

app.delete('/api/alerts/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM alert_configs WHERE id = ? AND merchant_id = ?').run(req.params.id, req.auth.merchantId);
  res.json({ deleted: true });
});

// ═══════════════════════════════════════════
//  STRIPE WEBHOOK
// ═══════════════════════════════════════════

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_demo';

app.post('/api/webhooks/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    const stripeBase = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_demo', {
      apiVersion: '2024-11-20.acacia',
    });
    event = stripeBase.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'charge.dispute.created') {
    await handleDisputeCreated(event.data.object as Stripe.Dispute);
  } else if (event.type === 'charge.dispute.closed') {
    await handleDisputeClosed(event.data.object as Stripe.Dispute);
  }

  res.json({ received: true });
});

async function handleDisputeCreated(stripeDispute: Stripe.Dispute): Promise<void> {
  const db = getDb();

  const chargeId =
    typeof stripeDispute.charge === 'string'
      ? stripeDispute.charge
      : stripeDispute.charge?.id ?? 'unknown';

  let customerId = 'unknown';
  let userId: string | null = null;

  try {
    // Try each connected account's Stripe to resolve the charge
    const accounts = db.prepare('SELECT * FROM connect_accounts').all() as any[];
    for (const acc of accounts) {
      try {
        const stripe = new Stripe(acc.access_token, { apiVersion: '2024-11-20.acacia' });
        const charge = await stripe.charges.retrieve(chargeId);
        if (charge.customer && typeof charge.customer === 'string') {
          customerId = charge.customer;
          userId = charge.metadata?.user_id ?? null;
        }
        break;
      } catch {}
    }
  } catch {}

  const existing = db
    .prepare('SELECT id FROM disputes WHERE stripe_dispute_id = ?')
    .get(stripeDispute.id);

  if (!existing) {
    const merchants = db.prepare('SELECT id FROM merchants WHERE active = 1 LIMIT 1').get() as { id: string } | undefined;
    const merchantId = merchants?.id ?? 'default';

    const id = uuid();
    db.prepare(`
      INSERT INTO disputes (id, merchant_id, stripe_dispute_id, charge_id, customer_id, payment_intent_id, amount, currency, reason, status, evidence_due_by, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, merchantId, stripeDispute.id, chargeId, customerId,
      stripeDispute.payment_intent as string | null,
      stripeDispute.amount, stripeDispute.currency, stripeDispute.reason,
      stripeDispute.status,
      stripeDispute.evidence_details?.due_by
        ? new Date(stripeDispute.evidence_details.due_by * 1000).toISOString()
        : null,
      userId
    );

    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Dispute | undefined;
    if (dispute) {
      sendAlert({
        event: 'charge.dispute.created',
        merchantId,
        dispute,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`New dispute recorded: ${stripeDispute.id}`);
  }
}

async function handleDisputeClosed(stripeDispute: Stripe.Dispute): Promise<void> {
  const db = getDb();
  db.prepare('UPDATE disputes SET status = ?, updated_at = datetime(\'now\') WHERE stripe_dispute_id = ?').run(
    stripeDispute.status, stripeDispute.id
  );
}

// ═══════════════════════════════════════════
//  MANUAL DISPUTE CREATION (testing)
// ═══════════════════════════════════════════

app.post('/api/disputes/manual', requireAuth, (req, res) => {
  const db = getDb();
  const { chargeId, customerId, userId, amount, currency, reason, stripeDisputeId: extDisputeId } = req.body as {
    chargeId: string; customerId: string; userId?: string;
    amount: number; currency?: string; reason?: string; stripeDisputeId?: string;
  };

  if (!chargeId || !customerId) {
    return res.status(400).json({ error: 'chargeId and customerId are required' });
  }

  const id = uuid();
  const stripeDisputeId = extDisputeId ?? `dp_demo_${Date.now()}`;

  db.prepare(`
    INSERT INTO disputes (id, merchant_id, stripe_dispute_id, charge_id, customer_id, payment_intent_id, amount, currency, reason, status, evidence_due_by, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.auth.merchantId, stripeDisputeId, chargeId, customerId, null, amount ?? 2900,
    currency ?? 'usd', reason ?? 'product_not_received', 'needs_response',
    new Date(Date.now() + 7 * 86400000).toISOString(), userId ?? customerId);

  res.json({ id, stripeDisputeId });
});

// ═══════════════════════════════════════════
//  DEMO DATA SEEDING
// ═══════════════════════════════════════════

app.post('/api/demo/seed', requireAuth, (req, res) => {
  const db = getDb();
  const userId = 'cust_demo_alice_123';
  const demoChargeId = 'ch_demo_3k2j1h4g5f';
  const now = Date.now();

  const seedEvents = [
    { e: 'user.signed_up', ts: now - 30 * 86400000, m: { email: 'alice@example.com', plan: 'pro' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'terms.accepted', ts: now - 30 * 86400000 + 5000, m: { version: 'v2.4' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'subscription.started', ts: now - 30 * 86400000 + 10000, m: { plan: 'pro_monthly', amount: 2900 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'payment.completed', ts: now - 30 * 86400000 + 15000, m: { invoice_id: 'in_001', amount: 2900 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'user.signed_in', ts: now - 25 * 86400000, m: {}, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'credits.purchased', ts: now - 20 * 86400000, m: { credits: 500, amount: 2000 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'credits.consumed', ts: now - 18 * 86400000, m: { credits: 50, model: 'gpt-4' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'output.generated', ts: now - 18 * 86400000 + 1000, m: { output_id: 'out_001', tokens: 2400 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'output.downloaded', ts: now - 18 * 86400000 + 5000, m: { output_id: 'out_001', format: 'pdf' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'credits.consumed', ts: now - 15 * 86400000, m: { credits: 100, model: 'claude-3' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'output.generated', ts: now - 15 * 86400000 + 1000, m: { output_id: 'out_002', tokens: 5100 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'output.exported', ts: now - 15 * 86400000 + 3000, m: { output_id: 'out_002', format: 'csv' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'user.signed_in', ts: now - 10 * 86400000, m: {}, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'credits.consumed', ts: now - 8 * 86400000, m: { credits: 75, model: 'gpt-4o' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'output.generated', ts: now - 8 * 86400000 + 1000, m: { output_id: 'out_003', tokens: 3200 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'user.signed_in', ts: now - 5 * 86400000, m: {}, ip: '192.168.1.42', dev: 'safari-iphone' },
    { e: 'credits.consumed', ts: now - 3 * 86400000, m: { credits: 25, model: 'gpt-4' }, ip: '192.168.1.42', dev: 'safari-iphone' },
    { e: 'output.generated', ts: now - 3 * 86400000 + 1000, m: { output_id: 'out_004', tokens: 900 }, ip: '192.168.1.42', dev: 'safari-iphone' },
    { e: 'subscription.renewed', ts: now - 2 * 86400000, m: { plan: 'pro_monthly', amount: 2900 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'payment.completed', ts: now - 2 * 86400000 + 5000, m: { invoice_id: 'in_002', amount: 2900 }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'invoice.viewed', ts: now - 1 * 86400000, m: { invoice_id: 'in_002' }, ip: '192.168.1.42', dev: 'chrome-mac' },
    { e: 'credits.purchased', ts: now - 2 * 86400000 + 10000, m: { credits: 1000, amount: 5000 }, ip: '192.168.1.42', dev: 'chrome-mac' },
  ];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO proof_events (id, merchant_id, user_id, event, metadata, ip_address, user_agent, device_id, session_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < seedEvents.length; i++) {
      const s = seedEvents[i];
      insert.run(
        uuid(), req.auth.merchantId, userId, s.e, JSON.stringify(s.m),
        s.ip, 'Mozilla/5.0 (Macintosh) Chrome/120.0', s.dev, `session_${i}`,
        new Date(s.ts).toISOString()
      );
    }
  });
  tx();

  const disputeId = uuid();
  db.prepare(`
    INSERT INTO disputes (id, merchant_id, stripe_dispute_id, charge_id, customer_id, payment_intent_id, amount, currency, reason, status, evidence_due_by, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(disputeId, req.auth.merchantId, `dp_demo_${Date.now()}`, demoChargeId, 'cust_demo_alice_123',
    'pi_demo_001', 2900, 'usd', 'product_not_received', 'needs_response',
    new Date(now + 7 * 86400000).toISOString(), userId);

  res.json({ seeded: seedEvents.length, disputeId, userId });
});

// ═══════════════════════════════════════════
//  DASHBOARD STATS
// ═══════════════════════════════════════════

app.get('/api/stats', requireAuth, (req, res) => {
  const db = getDb();

  const totalDisputes = (db.prepare(
    'SELECT COUNT(*) as c FROM disputes WHERE merchant_id = ?'
  ).get(req.auth.merchantId) as { c: number }).c;

  const wonDisputes = (db.prepare(
    'SELECT COUNT(*) as c FROM disputes WHERE merchant_id = ? AND status = ?'
  ).get(req.auth.merchantId, 'won') as { c: number }).c;

  const lostDisputes = (db.prepare(
    'SELECT COUNT(*) as c FROM disputes WHERE merchant_id = ? AND status = ?'
  ).get(req.auth.merchantId, 'lost') as { c: number }).c;

  const needsResponse = (db.prepare(
    'SELECT COUNT(*) as c FROM disputes WHERE merchant_id = ? AND status = ?'
  ).get(req.auth.merchantId, 'needs_response') as { c: number }).c;

  const totalEvents = (db.prepare(
    'SELECT COUNT(*) as c FROM proof_events WHERE merchant_id = ?'
  ).get(req.auth.merchantId) as { c: number }).c;

  const winRate = totalDisputes > 0 ? ((wonDisputes / (wonDisputes + lostDisputes || 1)) * 100).toFixed(0) : 0;

  res.json({
    totalDisputes, wonDisputes, lostDisputes, needsResponse,
    totalEvents, winRate,
    connected: !!req.auth.accessToken,
  });
});

// ═══════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`ProofPack backend running on http://localhost:${PORT}`);
});

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function buildDeviceFingerprint(
  ips: (string | null)[],
  _agents: (string | null)[],
  devices: (string | null)[],
  sessions: (string | null)[]
): string {
  const parts: string[] = [];
  if (ips.length > 0) parts.push(`IP Addresses: ${ips.join(', ')}`);
  if (devices.filter(Boolean).length > 0)
    parts.push(`Device IDs: ${devices.filter(Boolean).join(', ')}`);
  if (sessions.filter(Boolean).length > 0)
    parts.push(`Session count: ${sessions.filter(Boolean).length}`);
  parts.push('All activity traces back to a consistent digital identity.');
  return parts.join('\n');
}

// ═══════════════════════════════════════════
//  STATIC PAGES
// ═══════════════════════════════════════════

app.get('/privacy', (_req, res) => res.sendFile(pathResolve(__dirname, '..', 'public', 'privacy.html')));
app.get('/terms', (_req, res) => res.sendFile(pathResolve(__dirname, '..', 'public', 'terms.html')));
app.get('/support', (_req, res) => res.sendFile(pathResolve(__dirname, '..', 'public', 'support.html')));
