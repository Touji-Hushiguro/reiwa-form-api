import crypto from 'crypto';

const PIXEL_ID = '1478911910550864';
const GRAPH_VERSION = 'v20.0';
const CAPI_ENDPOINT = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`;

// SHA256 ハッシュ (Meta 要件: 小文字・トリム済みの文字列)
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

// 日本の電話番号 → E.164 形式 (+81XXXXXXXXXX)
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '+81' + digits.slice(1);
  if (digits.startsWith('81')) return '+' + digits;
  return '+81' + digits;
}

export interface CAPIEventParams {
  phone?: string;
  email?: string;
  fullName?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  eventSourceUrl?: string;
}

export async function sendLeadEvent(params: CAPIEventParams): Promise<void> {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!token) {
    console.warn('[CAPI] META_CAPI_ACCESS_TOKEN が未設定のためスキップ');
    return;
  }

  // ユーザーデータ組み立て
  const userData: Record<string, string> = {};

  if (params.phone) {
    try { userData.ph = sha256(normalizePhone(params.phone)); } catch { /* skip */ }
  }
  if (params.email) {
    userData.em = sha256(params.email);
  }
  if (params.fullName) {
    // 全角/半角スペースで姓名分割（例: 「山田 タロウ」→ ln=山田 fn=タロウ）
    const parts = params.fullName.trim().split(/[\s　]+/);
    if (parts.length >= 2) {
      userData.ln = sha256(parts[0]);
      userData.fn = sha256(parts.slice(1).join(''));
    } else {
      userData.fn = sha256(params.fullName.trim());
    }
  }
  if (params.clientIpAddress) userData.client_ip_address = params.clientIpAddress;
  if (params.clientUserAgent) userData.client_user_agent = params.clientUserAgent;
  if (params.fbp) userData.fbp = params.fbp;
  if (params.fbc) userData.fbc = params.fbc;

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: crypto.randomUUID(),
        action_source: 'website',
        event_source_url: params.eventSourceUrl ?? 'https://entry.reiwa-career.com/',
        user_data: userData,
      },
    ],
  };

  const url = new URL(CAPI_ENDPOINT);
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(`[CAPI] ${res.status} ${JSON.stringify(json)}`);
  }

  console.log('[CAPI] Lead sent:', JSON.stringify(json));
}
