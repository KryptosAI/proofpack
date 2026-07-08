import { v4 as uuid } from 'uuid';
import { getDb } from './db';

const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID ?? 'ppk_stripe_client_id';
const STRIPE_CLIENT_SECRET = process.env.STRIPE_CLIENT_SECRET ?? 'ppk_stripe_client_secret';
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3001';

export async function getConnectAuthUrl(merchantId: string): Promise<{ url: string; state: string }> {
  const state = uuid();
  const params = new URLSearchParams({
    client_id: STRIPE_CLIENT_ID,
    state,
    scope: 'read_write',
    response_type: 'code',
    redirect_uri: `${APP_BASE_URL}/api/connect/callback`,
    'stripe_user[email]': '',
    'stripe_user[url]': APP_BASE_URL,
  });

  return {
    url: `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
    state,
  };
}

export async function handleConnectCallback(
  code: string
): Promise<{ merchantId: string; stripeUserId: string } | null> {
  const response = await fetch('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_secret: STRIPE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) return null;

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    stripe_publishable_key: string;
    stripe_user_id: string;
    scope: string;
    livemode: boolean;
  };

  const db = getDb();

  const merchant = db.prepare('SELECT id FROM merchants LIMIT 1').get() as { id: string } | undefined;
  if (!merchant) {
    const mid = uuid();
    db.prepare('INSERT INTO merchants (id, name, email, stripe_account_id) VALUES (?, ?, ?, ?)').run(
      mid, 'Merchant', 'merchant@example.com', data.stripe_user_id
    );
  }

  const mId = merchant?.id ?? (db.prepare('SELECT id FROM merchants ORDER BY created_at DESC LIMIT 1').get() as { id: string }).id;

  const existing = db.prepare('SELECT id FROM connect_accounts WHERE stripe_user_id = ?').get(data.stripe_user_id);
  if (existing) {
    db.prepare(`
      UPDATE connect_accounts SET access_token = ?, refresh_token = ?, stripe_publishable_key = ?, scope = ?, livemode = ?, updated_at = datetime('now')
      WHERE stripe_user_id = ?
    `).run(data.access_token, data.refresh_token, data.stripe_publishable_key, data.scope, data.livemode ? 1 : 0, data.stripe_user_id);
  } else {
    db.prepare(`
      INSERT INTO connect_accounts (id, merchant_id, stripe_user_id, access_token, refresh_token, stripe_publishable_key, scope, livemode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), mId, data.stripe_user_id, data.access_token, data.refresh_token, data.stripe_publishable_key, data.scope, data.livemode ? 1 : 0);
  }

  db.prepare('UPDATE merchants SET stripe_account_id = ?, connected_at = datetime(\'now\') WHERE id = ?').run(data.stripe_user_id, mId);

  return { merchantId: mId, stripeUserId: data.stripe_user_id };
}
