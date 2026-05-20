// バージョン別設定
// v1: 既存LP (entry.reiwa-career.com/, /fv/)
// v2: 新UI (entry.reiwa-career.com/v2/) — 営業時間拡張・リードタイム短縮・1枠3件まで

export const SLOT_MINUTES = 15;
export const TZ = 'Asia/Tokyo';

export type VersionConfig = {
  BUSINESS_START_HOUR: number;
  BUSINESS_END_HOUR: number;
  LEAD_TIME_MINUTES: number;
  MAX_PER_SLOT: number;
};

export const CONFIG_V1: VersionConfig = {
  BUSINESS_START_HOUR: 11,
  BUSINESS_END_HOUR: 20,
  LEAD_TIME_MINUTES: 30,
  MAX_PER_SLOT: 1,
};

export const CONFIG_V2: VersionConfig = {
  BUSINESS_START_HOUR: 10,
  BUSINESS_END_HOUR: 20,
  LEAD_TIME_MINUTES: 0,   // リードタイムなし: 現在時刻の次の15分枠から選択可能
  MAX_PER_SLOT: 3,
};

export function getConfig(version: string | undefined): VersionConfig {
  return version === 'v2' ? CONFIG_V2 : CONFIG_V1;
}
