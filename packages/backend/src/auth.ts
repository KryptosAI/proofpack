import { Request, Response, NextFunction } from 'express';
import { getDb } from './db';

export interface AuthContext {
  merchantId: string;
  apiKey: string;
  apiKeyName: string;
  stripeUserId?: string;
  accessToken?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthContext;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing API key. Use: Authorization: Bearer ppk_...' });
    return;
  }

  const key = auth.slice(7);
  const db = getDb();

  const row = db.prepare(`
    SELECT ak.*, m.id as m_id, m.stripe_account_id, ca.access_token, ca.stripe_user_id
    FROM api_keys ak
    JOIN merchants m ON ak.merchant_id = m.id
    LEFT JOIN connect_accounts ca ON ca.merchant_id = m.id
    WHERE ak.key = ? AND ak.active = 1 AND m.active = 1
  `).get(key) as any;

  if (!row) {
    res.status(401).json({ error: 'Invalid or inactive API key' });
    return;
  }

  db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE key = ?').run(key);

  req.auth = {
    merchantId: row.m_id,
    apiKey: row.key,
    apiKeyName: row.name,
    stripeUserId: row.stripe_user_id ?? undefined,
    accessToken: row.access_token ?? undefined,
  };

  next();
}

export function requireConnect(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.accessToken) {
    res.status(402).json({ error: 'This action requires a connected Stripe account. Connect via Settings.' });
    return;
  }
  next();
}
