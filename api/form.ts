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
      // upsert: 既存行があれば update、なければ新規追加
      // (finalSubmit と firstSubmit の競合状態を回避するため)
      const rowIndex = await findRowByPhone(data.phone || '');
      if (rowIndex > 0) {
        await updateRow(rowIndex, data);
      } else {
        await writeNewRow(data);
      }
      return jsonResponse(res, 200, { success: true });
    }

    if (action === 'finalSubmit') {
      const rowIndex = await findRowByPhone(data.phone || '');
      if (rowIndex > 0) {
        await updateRow(rowIndex, data);
      } else {
        await writeNewRow(data);
      }
      // 後続処理はエラーが出ても全体は成功扱い
      try {
        const calResult = await createReservationEvent(data);
        if (!calResult.created) {
          console.warn('カレンダー登録スキップ:', calResult.reason);
        }
      } catch (calErr) {
        console.error('カレンダーエラー:', calErr);
      }
      try { await notifySlack(data); } catch (slackErr) { console.error('Slackエラー:', slackErr); }
      // 自動返信メールは Phase 後半で実装
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
