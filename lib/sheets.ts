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
// 注意: gridProperties.rowCount は「割り当て上限」であって「実データ行数」ではない。
//       (シートに 23920 行確保されてても、実データは 827 行までという状況がある)
//       なので A列を取得して "値が入ってる最終行" を特定してから、その近辺だけスキャンする。
export async function findRowByPhone(phone: string): Promise<number> {
  if (!phone) return -1;
  const sheets = sheetsClient();

  // A列(タイムスタンプ)で実データ最終行を特定
  const aRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });
  const aValues = aRes.data.values || [];
  let lastDataRow = 1;
  for (let i = aValues.length - 1; i >= 0; i--) {
    const cell = aValues[i]?.[0];
    if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
      lastDataRow = i + 1;
      break;
    }
  }
  if (lastDataRow <= 1) return -1;

  // 実データ最終行から遡って最新500行だけ J列をスキャン
  const startRow = Math.max(2, lastDataRow - 499);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!J${startRow}:J${lastDataRow}`,
  });
  const values = (res.data.values || []) as string[][];

  const normalized = phone.replace(/-/g, '').trim();
  for (let i = values.length - 1; i >= 0; i--) {
    const cell = String(values[i]?.[0] || '').replace(/-/g, '').trim();
    if (cell === normalized) return startRow + i;
  }
  return -1;
}

export async function writeNewRow(data: any): Promise<number> {
  const sheets = sheetsClient();

  // A列(タイムスタンプ)の実データ最終行を特定する
  // 注意: values.get の "trailing empty 自動除外" は「セルが完全に空」のときのみ。
  //       過去に "" (空文字列) が代入されてるセルは「データあり」扱いで返ってくる。
  //       なので末尾から逆向きに走査して、本当に値が入ってる行を探す。
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });
  const values = res.data.values || [];

  let lastDataRow = 1; // ヘッダ行を最低ライン
  for (let i = values.length - 1; i >= 0; i--) {
    const cell = values[i]?.[0];
    if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
      lastDataRow = i + 1; // 1-indexed
      break;
    }
  }
  const newRow = lastDataRow + 1;
  const rowToWrite = buildRow(data);
  console.log('[writeNewRow] target row:', newRow, 'data preview:', {
    A_timestamp: rowToWrite[0],
    G_name: rowToWrite[6],
    J_phone: rowToWrite[9],
    M_interview1: rowToWrite[12],
    P_utmSource: rowToWrite[15],
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${newRow}:Q${newRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowToWrite] },
  });
  console.log('[writeNewRow] write complete for row', newRow);
  return newRow;
}

// finalSubmit 時の行更新。A〜Q を丸ごと上書きすると業務GAS の onEdit が
// 反応中の行に再書き込みする形になり、Sheets API が応答を返さなくなる事象を確認。
// → 触る必要があるのは面談日時 M〜O だけなので、その範囲だけを update する。
//   (A〜L, P, Q は firstSubmit ですでに正しく書かれている)
export async function updateRow(rowIndex: number, data: any): Promise<void> {
  const sheets = sheetsClient();

  const t0 = Date.now();
  console.log('[updateRow] update M' + rowIndex + ':O' + rowIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!M${rowIndex}:O${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.interviewDateTime1 || '',
        data.interviewDateTime2 || '',
        data.interviewDateTime3 || '',
      ]],
    },
  });
  console.log('[updateRow] update done (' + (Date.now() - t0) + 'ms)');
}
