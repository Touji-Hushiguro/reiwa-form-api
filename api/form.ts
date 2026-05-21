import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, jsonResponse } from '../lib/cors';
import { sendOtp, verifyOtp } from '../lib/twilio';
import { writeNewRow, updateRow, findRowByPhone } from '../lib/sheets';
import { createReservationEvent } from '../lib/slots';
import { notifySlack } from '../lib/slack';

// フロントからのPOST body を JSON object に変換
// 対応: application/json, text/plain (sendBeacon), application/x-www-form-urlencoded (旧iframe form)
async function parseBody(req: VercelRequest): Promise<any> {
  let body: any = req.body;

  // Buffer の場合は文字列化
  if (body && typeof body === 'object' && Buffer.isBuffer(body)) {
    body = body.toString('utf-8');
  }

  // 文字列なら JSON parse 試行
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* ignore */ }
  }

  // FormData 風: "data" キーに JSON 文字列
  if (body && typeof body === 'object' && typeof body.data === 'string') {
    try { return JSON.parse(body.data); } catch { return body; }
  }

  return body || {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const data = await parseBody(req);
    const action = data.action || 'legacy';

    // ========== SMS認証 ==========
    if (action === 'sendOTP') {
      const result = await sendOtp(data.phone || '');
      return jsonResponse(res, 200, result.ok
        ? { success: true }
        : { success: false, error: result.error });
    }
    if (action === 'verifyOTP') {
      const result = await verifyOtp(data.phone || '', data.code || '');
      return jsonResponse(res, 200, result.ok
        ? { success: true, verified: true }
        : { success: false, error: result.error });
    }

    // ========== フォーム送信 ==========
    if (action === 'firstSubmit') {
      await writeNewRow(data);
      return jsonResponse(res, 200, { success: true });
    }

    if (action === 'finalSubmit') {
      // 通常は upsert (1顧客1行) 、findRowByPhone が遅い時は append フォールバック
      // 5秒以内に既存行が見つかれば update、見つからない or タイムアウトなら新規追加
      const rowIndex = await Promise.race<number>([
        findRowByPhone(data.phone || ''),
        new Promise<number>((resolve) => setTimeout(() => resolve(-2), 5000)),
      ]);
      if (rowIndex > 0) {
        await updateRow(rowIndex, data);
      } else {
        // rowIndex = -1 (該当なし) or -2 (タイムアウト) → 新規行追加
        await writeNewRow(data);
      }

      // カレンダー登録とSlack通知は並列実行
      const [calResult, slackResult] = await Promise.allSettled([
        createReservationEvent(data),
        notifySlack(data),
      ]);
      if (calResult.status === 'rejected') {
        console.error('カレンダーエラー:', calResult.reason);
      } else if (!calResult.value?.created) {
        console.warn('カレンダー登録スキップ:', calResult.value?.reason);
      }
      if (slackResult.status === 'rejected') {
        console.error('Slackエラー:', slackResult.reason);
      }

      return jsonResponse(res, 200, { success: true });
    }

    // 互換: action 指定なし
    await writeNewRow(data);
    return jsonResponse(res, 200, { success: true });
  } catch (err: any) {
    console.error('form handler error:', err);
    return jsonResponse(res, 500, { success: false, error: err?.message || 'unknown' });
  }
}
