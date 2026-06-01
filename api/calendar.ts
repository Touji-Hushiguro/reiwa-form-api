import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, jsonResponse } from '../lib/cors';
import { createReservationEvent } from '../lib/slots';

// フロントからのPOST body を JSON object に変換 (form.ts と同じ実装)
async function parseBody(req: VercelRequest): Promise<any> {
  let body: any = req.body;
  if (body && typeof body === 'object' && Buffer.isBuffer(body)) {
    body = body.toString('utf-8');
  }
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* ignore */ }
  }
  if (body && typeof body === 'object' && typeof body.data === 'string') {
    try { return JSON.parse(body.data); } catch { return body; }
  }
  return body || {};
}

/**
 * Google Calendar 予約イベント作成専用エンドポイント。
 *
 * 主な用途は project-alorn (sflp.reiwa-career.com) など別 Vercel プロジェクトから
 * HTTP 経由で entry の既存カレンダー登録ロジック (createReservationEvent) を呼ぶこと。
 * これにより重複チェック / イベント整形 / カレンダー権限 を 1 箇所に集約できる。
 *
 * 入力 (POST body):
 *  - fullName, phone, email, birthDate, gender, prefecture, workStart
 *  - interviewDateTime1 (表示用ラベル)
 *  - interviewStart, interviewEnd (ISO 8601, 実際のカレンダー登録に使用)
 *  - version (v1 / v2): MAX_PER_SLOT などの分岐に使用
 *
 * 返却:
 *  - { success: true, created: boolean, reason?: string }
 *  - created=false の場合 reason に "start/end未指定" / "枠満杯 (n/MAX)" など
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const data = await parseBody(req);
    console.log('[calendar] start', {
      phone: data.phone,
      fullName: data.fullName,
      interviewStart: data.interviewStart,
      interviewEnd: data.interviewEnd,
      version: data.version,
    });
    const result = await createReservationEvent(data);
    console.log('[calendar] done', result);
    return jsonResponse(res, 200, { success: true, ...result });
  } catch (err: any) {
    console.error('calendar handler error:', err);
    return jsonResponse(res, 500, { success: false, error: err?.message || 'unknown' });
  }
}
