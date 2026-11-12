import type { Db } from '../lib/prisma';

/** Every setting, with the value used until an admin changes it. */
export const SETTING_DEFAULTS = {
  coop_name: 'Inicbulan Waterworks Multi-purpose Cooperative',
  coop_address: '',
  coop_cda_no: '',
  membership_fee: '0.00',
  installation_fee: '0.00',
  account_no_prefix: 'A-',
  account_no_padding: '4',
  account_no_next: '1',
  member_no_prefix: '',
  member_no_padding: '4',
  member_no_next: '1',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.setting.findMany();
  const result: Settings = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (row.key in SETTING_DEFAULTS) result[row.key as SettingKey] = row.value;
  }
  return result;
}

export async function ensureDefaultSettings(db: Db) {
  for (const key of SETTING_KEYS) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value: SETTING_DEFAULTS[key] } });
  }
}
