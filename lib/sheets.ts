import { sheetsClient } from './google';
import { insertRowRequests, normalizePhone } from './sheet-write';

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

// 全件検索。直近500行の制限や数値保存で失われた先頭0で既存顧客を見落とさない。
async function findPhoneRow(spreadsheetId: string, sheetName: string, phone: string): Promise<number> {
  const key = normalizePhone(phone);
  if (!key) return -1;
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId, range: `'${sheetName.replace(/'/g, "''")}'!J2:J`,
  });
  const values = res.data.values || [];
  for (let i = values.length - 1; i >= 0; i--) {
    if (normalizePhone(values[i]?.[0]) === key) return i + 2;
  }
  return -1;
}

export async function findRowByPhone(phone: string): Promise<number> {
  return findPhoneRow(SPREADSHEET_ID, SHEET_NAME, phone);
}

async function findRowByPhoneInIS(phone: string): Promise<number> {
  return findPhoneRow(IS_DEST_SS_ID, IS_DEST_SHEET_NAME, phone);
}

// ============================================================
// IS チーム転送先シートへの転送 (架電部隊が見るシート)
// ============================================================
// 仕様 (1電話番号 = 1行):
//  - mode='insert' (firstSubmit 由来 / デフォルト):
//      - 既存行があればそれを update 扱いに切り替え (重複防止)
//      - なければ末尾に 1 行 insertDimension で追加し、A〜Q を書き込む
//  - mode='update' (finalSubmit 由来):
//      - J列(電話)で既存行を検索し、M〜O だけ上書き
//      - 見つからなければ防御的に insert にフォールバック
//  - 直前行の書式・入力規則(プルダウン)は inheritFromBefore で引き継ぐ
//  - J列(電話番号)が空ならスキップ
//  - try/catch でラップ、転送失敗しても呼び出し元(本体処理)は止めない
// ============================================================
export async function transferToIS(
  data: any,
  options: { mode?: 'insert' | 'update'; originalTimestamp?: string } = {},
): Promise<void> {
  const mode = options.mode || 'insert';
  const originalTimestamp = options.originalTimestamp;
  try {
    const phone = String(data.phone || '').trim();
    if (!phone) {
      console.log('[IS転送] J列(電話)空のためスキップ');
      return;
    }

    const sheets = sheetsClient();

    // ===== update モード: 既存行を探して M〜O だけ書き込み =====
    if (mode === 'update') {
      const existingRow = await findRowByPhoneInIS(phone);
      if (existingRow > 1) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: IS_DEST_SS_ID,
          range: `${IS_DEST_SHEET_NAME}!M${existingRow}:O${existingRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              data.interviewDateTime1 || '',
              data.interviewDateTime2 || '',
              data.interviewDateTime3 || '',
            ]],
          },
        });
        console.log(`[IS転送/update] 電話=${phone} → 行 ${existingRow} の M:O 更新`);
        return;
      }
      // 既存行が見つからない場合は防御的に insert へフォールバック
      console.warn(`[IS転送/update] 電話=${phone} の既存行なし → insert にフォールバック`);
    }

    // ===== insert モード: 既存行があれば update へ転送 (重複防止) =====
    if (mode === 'insert') {
      const existingRow = await findRowByPhoneInIS(phone);
      if (existingRow > 1) {
        // 既に行がある = firstSubmit が2回呼ばれた or 同電話が再送信した
        // 重複行を作らず、面談日時だけ最新値で上書きする
        const hasInterview =
          (data.interviewDateTime1 || data.interviewDateTime2 || data.interviewDateTime3);
        if (hasInterview) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: IS_DEST_SS_ID,
            range: `${IS_DEST_SHEET_NAME}!M${existingRow}:O${existingRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[
                data.interviewDateTime1 || '',
                data.interviewDateTime2 || '',
                data.interviewDateTime3 || '',
              ]],
            },
          });
          console.log(`[IS転送/insert→merge] 電話=${phone} 既存行 ${existingRow} の M:O 更新 (重複insert回避)`);
        } else {
          console.log(`[IS転送/insert→merge] 電話=${phone} 既存行 ${existingRow} あり・面談日時なし → スキップ`);
        }
        return;
      }
    }

    // ===== 末尾に 1 行 insert =====

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

    // 転送先タブの sheetId 取得
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: IS_DEST_SS_ID,
      fields: 'sheets(properties(sheetId,title))',
    });
    const sheetMeta = (meta.data.sheets || []).find(
      (s) => s.properties?.title === IS_DEST_SHEET_NAME,
    );
    const sheetId = sheetMeta?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
      throw new Error(`転送先タブ「${IS_DEST_SHEET_NAME}」が見つかりません`);
    }

    // 挿入と値の書き込みを同一の原子的バッチにする。
    // 別API呼び出しだと、同時リクエストが同じ行番号へ上書きして顧客が消える。
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: IS_DEST_SS_ID,
      requestBody: { requests: insertRowRequests(sheetId, lastDataRow, buildRow(data, originalTimestamp)) },
    }, { retry: false });

    console.log(`[IS転送/insert] 電話=${phone} → 行 ${newRow} (1行 insert, 書式継承)`);
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

  // 元シートタブの sheetId 取得 (insertDimension 用)
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const sheetMeta = (meta.data.sheets || []).find(
    (s) => s.properties?.title === SHEET_NAME,
  );
  const sheetId = sheetMeta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`元タブ「${SHEET_NAME}」が見つかりません`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: insertRowRequests(sheetId, lastDataRow, rowToWrite) },
  }, { retry: false });
  console.log('[writeNewRow] write complete for row', newRow, '(1行 insert, 書式継承)');

  // ⚠ IS 転送はここでは呼ばない。
  // 呼び出し側 (api/form.ts) が `waitUntil(transferToIS(...))` で明示的に
  // バックグラウンド実行する設計。fire-and-forget だと Vercel function が
  // return した瞬間に殺されて IS シートへの書き込みが欠落する事象があった。
  return newRow;
}

// finalSubmit 時の行更新。A〜Q を丸ごと上書きすると業務GAS の onEdit が
// 反応中の行に再書き込みする形になり、Sheets API が応答を返さなくなる事象を確認。
// → 触る必要があるのは面談日時 M〜O だけなので、その範囲だけを update する。
//   (A〜L, P, Q は firstSubmit ですでに正しく書かれている)
export async function updateRow(rowIndex: number, data: any): Promise<void> {
  const sheets = sheetsClient();

  // firstSubmit後に他の挿入で行番号が変わっている可能性がある。
  const rowPhone = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!J${rowIndex}`,
  });
  if (!normalizePhone(data.phone)) throw new Error('更新対象の電話番号が空です');
  if (normalizePhone(rowPhone.data.values?.[0]?.[0]) !== normalizePhone(data.phone)) {
    rowIndex = await findRowByPhone(String(data.phone));
    if (rowIndex < 2) throw new Error('更新対象が見つかりません。行番号だけで上書きしません');
  }
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

  // ⚠ IS 転送はここでは呼ばない。呼び出し側 (api/form.ts) で waitUntil する。
}
