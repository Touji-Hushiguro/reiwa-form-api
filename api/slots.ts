import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, jsonResponse } from '../lib/cors';
import { getConfig } from '../lib/config';
import { getQuickSlots, getAllAvailableSlots, getInstantSlot } from '../lib/slots';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const action = String(req.query.action || 'quick_slots');
    const version = String(req.query.version || 'v1');
    const config = getConfig(version);

    if (action === 'all_slots') {
      const days = parseInt(String(req.query.days || '14'), 10);
      const slots = await getAllAvailableSlots(days, config);
      return jsonResponse(res, 200, { success: true, slots });
    }
    if (action === 'instantSlot') {
      const slot = await getInstantSlot(config);
      return jsonResponse(res, 200, { success: true, slot });
    }
    // default: quick_slots
    const slots = await getQuickSlots(config);
    return jsonResponse(res, 200, { success: true, slots });
  } catch (err: any) {
    console.error('slots handler error:', err);
    return jsonResponse(res, 500, { success: false, error: err?.message || 'unknown' });
  }
}
