import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, jsonResponse } from '../lib/cors';
import { sendOtp, verifyOtp } from '../lib/twilio';
import { writeNewRow, updateRow, findRowByPhone } from '../lib/sheets';
import { createReservationEvent } from '../lib/slots';
import { notifySlack } from '../lib/slack';

// 外部呼び出しが沈黙しないよう明示的にタイムアウトを噛ませる
// (Vercel function 全体の 60s タイムアウトが先に走ると原因が分からないため)
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms),
    ),
  ]);
}

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
      // 新規行追加して行番号を返す → frontend が sessionStorage に保存し、finalSubmit で送り返す
      const rowIndex = await writeNewRow(data);
      return jsonResponse(res, 200, { success: true, rowIndex });
    }

    if (action === 'finalSubmit') {
      console.log('[finalSubmit] start', {
        rowIndex: data.rowIndex,
        phone: data.phone,
        interviewDateTime1: data.interviewDateTime1,
        interviewDateTime2: data.interviewDateTime2,
        interviewDateTime3: data.interviewDateTime3,
        interviewStart: data.interviewStart,
        interviewEnd: data.interviewEnd,
        version: data.version,
        userAgent: req.headers['user-agent'],
      });

      // 1. frontend から渡された rowIndex があれば直接 update (理想ケース、最速)
      // 2. なければ findRowByPhone 5秒タイムアウト付きでフォールバック
      // 3. それでもダメなら新規追加
      let rowIndex = parseInt(String(data.rowIndex || 0), 10);
      if (!(rowIndex > 1)) {
        console.log('[finalSubmit] no rowIndex, calling findRowByPhone');
        try {
          rowIndex = await Promise.race<number>([
            findRowByPhone(data.phone || ''),
            new Promise<number>((resolve) => setTimeout(() => resolve(-2), 5000)),
          ]);
          console.log('[finalSubmit] findRowByPhone done', { rowIndex });
        } catch (e: any) {
          console.error('[finalSubmit] findRowByPhone error', e?.message || e);
          rowIndex = -2;
        }
      }

      if (rowIndex > 0) {
        console.log('[finalSubmit] calling updateRow', { rowIndex });
        await withTimeout(updateRow(rowIndex, data), 20000, 'updateRow');
        console.log('[finalSubmit] updateRow done');
      } else {
        console.log('[finalSubmit] calling writeNewRow (fallback)');
        await withTimeout(writeNewRow(data), 20000, 'writeNewRow');
        console.log('[finalSubmit] writeNewRow done');
      }

      // カレンダー登録とSlack通知は並列実行（各々タイムアウト付き）
      console.log('[finalSubmit] calling cal + slack');
      const [calResult, slackResult] = await Promise.allSettled([
        withTimeout(createReservationEvent(data), 15000, 'createReservationEvent'),
        withTimeout(notifySlack(data), 10000, 'notifySlack'),
      ]);
      if (calResult.status === 'rejected') {
        console.error('カレンダーエラー:', calResult.reason?.message || calResult.reason);
      } else if (!calResult.value?.created) {
        console.warn('カレンダー登録スキップ:', calResult.value?.reason);
      }
      if (slackResult.status === 'rejected') {
        console.error('Slackエラー:', slackResult.reason?.message || slackResult.reason);
      } else {
        console.log('[finalSubmit] Slack通知 fulfilled (送信完了)');
      }
      console.log('[finalSubmit] done');

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
