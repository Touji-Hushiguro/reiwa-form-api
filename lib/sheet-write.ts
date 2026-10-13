import type { sheets_v4 } from 'googleapis';

export function normalizePhone(value: unknown): string {
  let phone = String(value ?? '').normalize('NFKC').replace(/[\s\-‐‑‒–—―ー]/g, '');
  if (phone.startsWith('+81')) phone = '0' + phone.slice(3);
  // 既存の数値セルで0が落ちた日本の携帯番号だけを補正する。
  if (/^[789]0\d{8}$/.test(phone)) phone = '0' + phone;
  return phone;
}

function dateSerial(value: string): number | undefined {
  const m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?: (\d{1,2}):(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return undefined;
  const parts = m.slice(1).map(v => Number(v || 0));
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return undefined;
  // Sheetsの日付シリアルはローカル日時。JSTの文字列をさらに9時間ずらさない。
  return date.getTime() / 86400000 + 25569;
}

export function insertRowRequests(sheetId: number, afterRow: number,
  row: (string | number)[]): sheets_v4.Schema$Request[] {
  if (!Number.isInteger(afterRow) || afterRow < 1 || row.length !== 17) {
    throw new Error('Invalid insertion row or A:Q data');
  }
  const values = row.map((value, index) => {
    const serial = (index === 0 || index === 7) ? dateSerial(String(value)) : undefined;
    const userEnteredValue = serial !== undefined ? { numberValue: serial }
      : typeof value === 'number' && index !== 9 ? { numberValue: value }
      : { stringValue: String(value) };
    return { userEnteredValue };
  });
  return [
    { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: afterRow,
      endIndex: afterRow + 1 }, inheritFromBefore: true } },
    { updateCells: { start: { sheetId, rowIndex: afterRow, columnIndex: 0 },
      rows: [{ values }], fields: 'userEnteredValue' } },
  ];
}
