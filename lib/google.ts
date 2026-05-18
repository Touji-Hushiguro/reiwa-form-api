import { google, sheets_v4, calendar_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

let cachedAuth: JWT | null = null;

function getServiceAccountJson(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が未設定');
  let parsed: { client_email: string; private_key: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON は有効なJSON文字列にしてください');
  }
  // Vercel の環境変数で改行が "\n" 文字列としてエスケープされている場合に復元
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function getAuth(): JWT {
  if (cachedAuth) return cachedAuth;
  const { client_email, private_key } = getServiceAccountJson();
  cachedAuth = new JWT({
    email: client_email,
    key: private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
    ],
  });
  return cachedAuth;
}

export function sheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

export function calendarClient(): calendar_v3.Calendar {
  return google.calendar({ version: 'v3', auth: getAuth() });
}
