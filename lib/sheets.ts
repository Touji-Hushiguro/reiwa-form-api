import { sheetsClient } from './google';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const SHEET_NAME = process.env.SHEET_NAME || '顧客データDB';
const TOTAL_COLS = 17;

// 列定義（既存スプシのスキーマ厳守）
export const COL = {
  TIMESTAMP: 1,
  WORK_START: 2,
  JOB_TYPE: 3,
  CONDITION: 4,
  EDUCATION: 5,
  EMPLOYMENT_STATUS: 6,
  FULL_NAME: 7,
  BIRTH_DATE: 8,
  GENDER: 9,
  PHONE: 10,
  EMAIL: 11,
  PREFECTURE: 12,
  INTERVIEW_1: 13,
  INTERVIEW_2: 14,
  INTERVIEW_3: 15,
  UTM_SOURCE: 16,
  UTM_CONTENT: 17,
} as const;

function nowTimestamp(): string {
  // JST タイムスタンプ "yyyy/MM/dd HH:mm:ss"
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function arrJoin(v: any): string {
  if (Array.isArray(v)) return v.join(', ');
  return v || '';
}

export function buildRow(data: any, timestamp?: string): (string | number)[] {
  return [
    timestamp || nowTimestamp(),
    data.workStart || '',
    arrJoin(data.jobType),
    arrJoin(data.condition),
    data.education || '',
    data.employmentStatus || '',
    data.fullName || '',
    data.birthDate || '',
    data.gender || '',
    data.phone || '',
    data.email || '',
    data.prefecture || '',
    data.interviewDateTime1 || '',
    data.interviewDateTime2 || '',
    data.interviewDateTime3 || '',
    data.utmSource || '',
    data.utmContent || '',
  ];
}

async function getAllRows(): Promise<any[][]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });
  return (res.data.values || []) as any[][];
}

// 電話番号で既存行を逆順検索
export async function findRowByPhone(phone: string): Promise<number> {
  if (!phone) return -1;
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!J:J`, // PHONE column
  });
  const values = (res.data.values || []) as string[][];
  const normalized = phone.replace(/-/g, '').trim();
  for (let i = values.length - 1; i >= 1; i--) {
    const cell = String(values[i]?.[0] || '').replace(/-/g, '').trim();
    if (cell === normalized) return i + 1; // 1-indexed row number
  }
  return -1;
}

export async function writeNewRow(data: any): Promise<void> {
  const sheets = sheetsClient();
  // A列の長さで次の行を判定
  const colA = await getAllRows();
  const nextRow = colA.length + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${nextRow}:Q${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [buildRow(data)] },
  });
}

export async function updateRow(rowIndex: number, data: any): Promise<void> {
  const sheets = sheetsClient();
  // 既存行を一括取得（A〜Q列）
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex}:Q${rowIndex}`,
  });
  const existing = (existingRes.data.values?.[0] || []) as string[];

  // 既存タイムスタンプ保持
  const ts = String(existing[0] || '') || nowTimestamp();

  // 空フィールドは既存値で補完（firstSubmit と finalSubmit の競合対策）
  // インデックスは buildRow() の順序に対応
  const merged: any = { ...data };
  const preserveIfEmpty = (key: string, idx: number) => {
    if (!merged[key] && existing[idx]) merged[key] = String(existing[idx]);
  };
  preserveIfEmpty('workStart',        1);   // B
  preserveIfEmpty('jobType',          2);   // C
  preserveIfEmpty('condition',        3);   // D
  preserveIfEmpty('education',        4);   // E
  preserveIfEmpty('employmentStatus', 5);   // F
  preserveIfEmpty('fullName',         6);   // G
  preserveIfEmpty('birthDate',        7);   // H
  preserveIfEmpty('gender',           8);   // I
  preserveIfEmpty('phone',            9);   // J
  preserveIfEmpty('email',           10);   // K
  preserveIfEmpty('prefecture',      11);   // L
  preserveIfEmpty('interviewDateTime1', 12); // M ★面談日時
  preserveIfEmpty('interviewDateTime2', 13); // N
  preserveIfEmpty('interviewDateTime3', 14); // O
  preserveIfEmpty('utmSource',       15);   // P
  preserveIfEmpty('utmContent',      16);   // Q

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex}:Q${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [buildRow(merged, ts)] },
  });
}
