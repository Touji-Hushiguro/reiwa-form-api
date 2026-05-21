export async function notifySlack(data: any): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return; // Slack 未設定でも処理続行

  const lines: string[] = [];
  lines.push('<@U0ABRUC6JRE> :mega: 新しい応募');
  lines.push('名前: ' + (data.fullName || '未入力'));
  lines.push('電話: ' + (data.phone || '未入力'));
  lines.push('予約日時: ' + (data.interviewDateTime1 || '未入力'));
  lines.push('メール: ' + (data.email || '未入力'));
  lines.push('都道府県: ' + (data.prefecture || '未入力'));
  lines.push('転職希望時期: ' + (data.workStart || '未入力'));
  lines.push('配信媒体: ' + (data.utmSource || '不明'));
  lines.push('CR: ' + (data.utmContent || '不明'));
  lines.push('バージョン: ' + (data.version || 'v1'));
  const SHEET_ID = process.env.SPREADSHEET_ID || '';
  if (SHEET_ID) {
    lines.push(`<https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit|スプレッドシート>`);
  }

  // Slack webhook が応答しないと function 全体が止まるので 8秒タイムアウト
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('Slack通知エラー', err);
  } finally {
    clearTimeout(timer);
  }
}
