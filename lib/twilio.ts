import twilio from 'twilio';

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio 認証情報が未設定');
  return twilio(sid, token);
}

function normalizePhoneJP(phone: string): string {
  const digits = String(phone).replace(/[-\s　]/g, '');
  const stripped = digits.startsWith('0') ? digits.substring(1) : digits;
  return '+81' + stripped;
}

export async function sendOtp(phone: string): Promise<{ ok: boolean; error?: string }> {
  const verifySid = process.env.TWILIO_VERIFY_SID;
  if (!verifySid) return { ok: false, error: 'TWILIO_VERIFY_SID が未設定' };
  const to = normalizePhoneJP(phone);
  if (to.length < 12) return { ok: false, error: '電話番号が不正です' };

  try {
    const verification = await getClient()
      .verify.v2.services(verifySid)
      .verifications.create({ to, channel: 'sms' });
    if (verification.status === 'pending') return { ok: true };
    return { ok: false, error: 'SMS送信に失敗しました' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'SMS送信に失敗しました' };
  }
}

export async function verifyOtp(
  phone: string,
  code: string,
): Promise<{ ok: boolean; verified?: boolean; error?: string }> {
  const verifySid = process.env.TWILIO_VERIFY_SID;
  if (!verifySid) return { ok: false, error: 'TWILIO_VERIFY_SID が未設定' };
  const to = normalizePhoneJP(phone);
  const trimmedCode = String(code || '').trim();
  if (!to || !trimmedCode) return { ok: false, error: '電話番号またはコードが不正です' };

  try {
    const check = await getClient()
      .verify.v2.services(verifySid)
      .verificationChecks.create({ to, code: trimmedCode });
    if (check.status === 'approved') return { ok: true, verified: true };
    return { ok: false, error: 'コードが正しくありません' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'コード検証に失敗しました' };
  }
}
