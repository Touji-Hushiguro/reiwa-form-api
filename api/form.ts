import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, jsonResponse } from '../lib/cors';
import { sendOtp, verifyOtp } from '../lib/twilio';
import { writeNewRow, updateRow, findRowByPhone } from '../lib/sheets';
import { createReservationEvent } from '../lib/slots';
import { notifySlack } from '../lib/slack';

// 既存 GAS との互換: フロントが FormData の "data" フィールドに JSON 文字列を入れて POST してくる
// 加えて application/json POST も受け付ける
async function parseBody(req: VercelRequest): Promise<any> {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  // Vercel は通常 req.body をパース済みで渡す
  let body = req.body;

  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* ignore */ }
  }

  // FormData 風に "data" キーに JSON 文字列が入ってるパターン
  if (body && typeof body === 'object' && typeof body.data === 'string') {
    try { return JSON.parse(body.data); } catch { return body; }
  }

  // multipart/form-data の場合、Vercel は自動パースしないので生 body を扱う必要あり
  // しかし @vercel/node でも multipart は body 文字列として渡されるため、上記のJSONパースで処理
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
