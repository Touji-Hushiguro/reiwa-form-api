import { sheetsClient } from './google';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const SHEET_NAME = process.env.SHEET_NAME || '顧客データDB';
const TOTAL_COLS = 17;

// IS チーム転送先スプシ (架電部隊が見るシート)
const IS_DEST_SS_ID = '1XrGfX7JMiGPpa2ICd1pWrkDrHvd4hFzZoIsdxzCvqas';
const IS_DEST_SHEET_NAME = '顧客データDB';

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

// 1-indexed 列番号 → A1表記の列文字 (1→A, 26→Z, 27→AA, 77→BY)
function colNumToLetter(n: number): string {
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
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

// ============================================================
// IS チーム転送先シートへの append (架電部隊が見るシート)
// ============================================================
// 仕様:
//  - append 専用 (firstSubmit/finalSubmit どちらも末尾に新規行として追記)
//  - 行位置は記憶せず、毎回 A列スキャンで実データ最終行を再特定
//  - 直前行の書式・入力規則(プルダウン)を copyPaste で引き継ぐ
//  - R列以降(IS チームの手入力列)は values.clear で空にする
//  - J列(電話番号)が空ならスキップ
//  - try/catch でラップ、転送失敗しても呼び出し元(本体処理)は止めない
// ============================================================
export async function transferToIS(data: any): Promise<void> {
  try {
    const phone = String(data.phone || '').trim();
    if (!phone) {
      console.log('[IS転送] J列(電話)空のためスキップ');
      return;
    }

    const sheets = sheetsClient();

    // 転送先の A列で実データ最終行を特定
    const aRes = await sheets.spreadsheets.values.get({
      spreadsheetId: IS_DEST_SS_ID,
      range: `${IS_DEST_SHEET_NAME}!A:A`,
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
    const newRow = lastDataRow + 1;

    // 転送先タブの sheetId と列数を取得 (batchUpdate / clear 用)
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: IS_DEST_SS_ID,
      fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))',
    });
    const sheetMeta = (meta.data.sheets || []).find(
      (s) => s.properties?.title === IS_DEST_SHEET_NAME,
    );
    const sheetId = sheetMeta?.properties?.sheetId;
    const colCount = sheetMeta?.properties?.gridProperties?.columnCount || 26;
    if (sheetId === undefined || sheetId === null) {
      throw new Error(`転送先タブ「${IS_DEST_SHEET_NAME}」が見つかりません`);
    }

    // 直前行(lastDataRow) の書式・入力規則を新規行(newRow) にコピー
    //  - PASTE_NORMAL は値+書式+検証を全部コピー
    //  - 直後に A〜Q を上書き、R以降をクリアすることで「書式・入力規則のみ継承」と同じ結果を得る
    if (lastDataRow >= 2) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: IS_DEST_SS_ID,
        requestBody: {
          requests: [
            {
              copyPaste: {
                source: {
                  sheetId,
                  startRowIndex: lastDataRow - 1, // 0-indexed
                  endRowIndex: lastDataRow,
                },
                destination: {
                  sheetId,
                  startRowIndex: newRow - 1,
                  endRowIndex: newRow,
                },
                pasteType: 'PASTE_NORMAL',
                pasteOrientation: 'NORMAL',
              },
            },
          ],
        },
      });
    }

    // A〜Q (17列) に新規データを書き込み (copyPaste で入った前行の値は上書きされる)
    await sheets.spreadsheets.values.update({
      spreadsheetId: IS_DEST_SS_ID,
      range: `${IS_DEST_SHEET_NAME}!A${newRow}:Q${newRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [buildRow(data)] },
    });

    // R列以降(IS チームの手入力列) の値だけクリア (書式・入力規則は維持)
    if (colCount > TOTAL_COLS) {
      const lastColLetter = colNumToLetter(colCount);
      await sheets.spreadsheets.values.clear({
        spreadsheetId: IS_DEST_SS_ID,
        range: `${IS_DEST_SHEET_NAME}!R${newRow}:${lastColLetter}${newRow}`,
      });
    }

    console.log(`[IS転送] 電話=${phone} → 行 ${newRow}`);
  } catch (e: any) {
    console.error('[IS転送エラー]', e?.message || e);
  }
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

  // IS チーム転送先にも追記 (失敗しても本体は止めない)
  await transferToIS(data);

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

  // IS チーム転送先にも追記 (失敗しても本体は止めない)
  await transferToIS(data);
}
