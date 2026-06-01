import type { VercelRequest, VercelResponse } from '@vercel/node';

// 環境変数 ALLOWED_ORIGINS (カンマ区切り) と
// 下記のコード側ハードコード分の和集合で許可する。
// 環境変数は Sensitive 設定下で空文字に見えるケースがあるため、
// 本番で常に許可したいドメインはコードで明示する。
const ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const DEFAULT_ALLOWED = [
  'https://entry.reiwa-career.com',
  'https://sflp.reiwa-career.com',
  'http://localhost:3002',
];

const ALLOWED_ORIGINS = Array.from(new Set([...DEFAULT_ALLOWED, ...ENV_ORIGINS]));

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // preflight handled, caller should return
  }
  return false;
}

export function jsonResponse(res: VercelResponse, status: number, body: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
}
