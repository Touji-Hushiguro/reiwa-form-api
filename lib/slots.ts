import { calendarClient } from './google';
import { SLOT_MINUTES, TZ, getConfig, VersionConfig } from './config';

const CALENDAR_ID = process.env.CALENDAR_ID || '';

export type Slot = {
  dateLabel: string;
  timeLabel: string;
  label: string;
  start: string;
  end: string;
};

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

// JST 基準で「年/月/日」を取り出す
function jstParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value || '0';
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
  };
}

// JST の指定時刻を Date に変換（UTCとして表現）
function jstDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  // JST = UTC + 9
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0));
}

function formatJstSlot(start: Date, end: Date): Slot {
  const sp = jstParts(start);
  const ep = jstParts(end);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const sDate = new Date(Date.UTC(sp.year, sp.month - 1, sp.day));
  const dayLabel = days[sDate.getUTCDay()];
  const dateLabel = `${sp.month}/${sp.day}(${dayLabel})`;
  const timeLabel = `${pad2(sp.hour)}:${pad2(sp.minute)}〜${pad2(ep.hour)}:${pad2(ep.minute)}`;
  return {
    dateLabel,
    timeLabel,
    label: `${dateLabel} ${timeLabel}`,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function getEventsBetween(start: Date, end: Date) {
  const cal = calendarClient();
  const res = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500,
  });
  return res.data.items || [];
}

// 同一15分枠への重複予約は MAX_PER_SLOT 件まで許容
// 終日イベントは常にブロック扱い
function isSlotFull(slotStart: Date, slotEnd: Date, events: any[], maxPerSlot: number): boolean {
  let count = 0;
  for (const ev of events) {
    // 終日イベント判定
    if (ev.start?.date && !ev.start?.dateTime) return true;
    const evStart = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
    const evEnd = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
    if (!evStart || !evEnd) continue;
    if (slotStart.getTime() < evEnd.getTime() && slotEnd.getTime() > evStart.getTime()) {
      count++;
      if (count >= maxPerSlot) return true;
    }
  }
  return false;
}

export async function findAllSlotsOfDay(
  jstYear: number, jstMonth: number, jstDay: number,
  now: Date,
  config: VersionConfig,
): Promise<Slot[]> {
  const dayStart = jstDate(jstYear, jstMonth, jstDay, config.BUSINESS_START_HOUR, 0);
  const dayEnd = jstDate(jstYear, jstMonth, jstDay, config.BUSINESS_END_HOUR, 0);

  // リードタイム考慮した最早時刻（厳密に15分単位の境界へ切り上げ、ミリ秒含む）
  // 例: 19:20 → 19:30 / 19:15:00 → 19:15 / 19:15:01 → 19:30
  const slotMs = SLOT_MINUTES * 60 * 1000;
  const earliestRaw = now.getTime() + config.LEAD_TIME_MINUTES * 60 * 1000;
  const earliestMs = Math.ceil(earliestRaw / slotMs) * slotMs;
  const earliest = new Date(earliestMs);

  const scanStart = dayStart.getTime() < earliest.getTime() ? earliest : dayStart;
  if (scanStart.getTime() >= dayEnd.getTime()) return [];

  const events = await getEventsBetween(dayStart, dayEnd);

  const result: Slot[] = [];
  let cursor = new Date(scanStart.getTime());
  while (cursor.getTime() + SLOT_MINUTES * 60 * 1000 <= dayEnd.getTime()) {
    const slotEnd = new Date(cursor.getTime() + SLOT_MINUTES * 60 * 1000);
    if (!isSlotFull(cursor, slotEnd, events, config.MAX_PER_SLOT)) {
      result.push(formatJstSlot(cursor, slotEnd));
    }
    cursor = new Date(cursor.getTime() + SLOT_MINUTES * 60 * 1000);
  }
  return result;
}

async function findEarliestSlotOfDay(
  jstYear: number, jstMonth: number, jstDay: number,
  now: Date,
  config: VersionConfig,
): Promise<Slot | null> {
  const slots = await findAllSlotsOfDay(jstYear, jstMonth, jstDay, now, config);
  return slots[0] || null;
}

export async function getQuickSlots(config: VersionConfig): Promise<Slot[]> {
  const now = new Date();
  const todayJst = jstParts(now);
  const results: Slot[] = [];
  for (let i = 0; i < 3; i++) {
    const target = new Date(Date.UTC(todayJst.year, todayJst.month - 1, todayJst.day + i));
    const p = jstParts(target);
    const slot = await findEarliestSlotOfDay(p.year, p.month, p.day, now, config);
    if (slot) results.push(slot);
  }
  return results;
}

export async function getAllAvailableSlots(days: number, config: VersionConfig): Promise<Slot[]> {
  const now = new Date();
  const todayJst = jstParts(now);
  const results: Slot[] = [];
  for (let i = 0; i < days; i++) {
    const target = new Date(Date.UTC(todayJst.year, todayJst.month - 1, todayJst.day + i));
    const p = jstParts(target);
    const slots = await findAllSlotsOfDay(p.year, p.month, p.day, now, config);
    results.push(...slots);
  }
  return results;
}

export async function getInstantSlot(config: VersionConfig): Promise<Slot | null> {
  const now = new Date();
  const todayJst = jstParts(now);
  for (let i = 0; i < 14; i++) {
    const target = new Date(Date.UTC(todayJst.year, todayJst.month - 1, todayJst.day + i));
    const p = jstParts(target);
    const slot = await findEarliestSlotOfDay(p.year, p.month, p.day, now, config);
    if (slot) return slot;
  }
  return null;
}

export async function createReservationEvent(data: any): Promise<{ created: boolean; reason?: string }> {
  if (!data.interviewStart || !data.interviewEnd) {
    return { created: false, reason: 'start/end未指定' };
  }
  const config = getConfig(data.version);
  const startDate = new Date(data.interviewStart);
  const endDate = new Date(data.interviewEnd);

  // race condition チェック: 該当枠の重複件数
  const cal = calendarClient();
  const eventsRes = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    maxResults: 100,
  });
  const events = eventsRes.data.items || [];
  let overlapCount = 0;
  for (const ev of events) {
    if (ev.start?.date && !ev.start?.dateTime) continue; // skip all-day
    const evStart = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
    const evEnd = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
    if (!evStart || !evEnd) continue;
    if (startDate.getTime() < evEnd.getTime() && endDate.getTime() > evStart.getTime()) {
      overlapCount++;
    }
  }
  if (overlapCount >= config.MAX_PER_SLOT) {
    return { created: false, reason: `枠満杯 (${overlapCount}/${config.MAX_PER_SLOT})` };
  }

  const name = data.fullName || 'お客様';
  const title = '【架電】' + name + '様 予約用カレンダー';
  const description = buildEventDescription(data);
  await cal.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: title,
      description,
      start: { dateTime: startDate.toISOString(), timeZone: TZ },
      end: { dateTime: endDate.toISOString(), timeZone: TZ },
    },
  });
  return { created: true };
}

function buildEventDescription(data: any): string {
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
  const lines = [
    '━━━ 応募内容 ━━━',
    'お名前: ' + (data.fullName || ''),
    '電話: ' + (data.phone || ''),
    'メール: ' + (data.email || ''),
    '生年月日: ' + (data.birthDate || ''),
    '性別: ' + (data.gender || ''),
    '都道府県: ' + (data.prefecture || ''),
    '転職希望時期: ' + (data.workStart || ''),
    '希望日時: ' + (data.interviewDateTime1 || ''),
    'バージョン: ' + (data.version || 'v1'),
    '',
    '━━━ スプレッドシート ━━━',
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID,
  ];
  return lines.join('\n');
}
