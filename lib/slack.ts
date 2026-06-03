// type:
//   'phone_auth'       = firstSubmit 由来 (電話認証完了、面談日時未確定)
//   'interview_booked' = finalSubmit 由来 (面談日時確定済み) ← デフォルト
export async function notifySlack(
  data: any,
  options?: { type?: 'phone_auth' | 'interview_booked' },
): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return; // Slack 未設定でも処理続行

  const type = options?.type ?? 'interview_booked';

  const lines: string[] = [];
  if (type === 'phone_auth') {
    lines.push('<@U0ABRUC6JRE> :iphone: 電話認証完了 (面談日時未確定)');
  } else {
    lines.push('<@U0ABRUC6JRE> :mega: 面談予約完了');
  }
  lines.push('名前: ' + (data.fullName || '未入力'));
  lines.push('電話: ' + (data.phone || '未入力'));
  if (type === 'interview_booked') {
    lines.push('予約日時: ' + (data.interviewDateTime1 || '未入力'));
  }
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
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: controller.signal,
    });
    if (res.ok) {
      console.log(`[Slack] 送信成功 (status=${res.status}) version=${data.version || 'v1'} phone=${data.phone || '-'}`);
    } else {
      const body = await res.text().catch(() => '');
      console.error(`[Slack] HTTPエラー status=${res.status} body=${body}`);
    }
  } catch (err) {
    console.error('Slack通知エラー', err);
  } finally {
    clearTimeout(timer);
  }
}
