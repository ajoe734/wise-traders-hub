/**
 * /holding-checkup 專用格式化 helpers（Monocle 改版）
 * 憲法：正號 `+`、負號 `−` (U+2212)；金額 ≥ 10,000 用「X.X 萬」；報酬條共用 ±40 尺規。
 */

const MINUS = '\u2212';

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v as number)) return '—';
  const abs = Math.abs(v as number);
  const s = abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if ((v as number) > 0) return `+${s}`;
  if ((v as number) < 0) return `${MINUS}${s}`;
  return s;
}

export function fmtSignedInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v as number)) return '—';
  const abs = Math.abs(Math.round(v as number));
  const s = abs.toLocaleString();
  if ((v as number) > 0) return `+${s}`;
  if ((v as number) < 0) return `${MINUS}${s}`;
  return s;
}

/** 金額顯示：< 10,000 直接數字；≥ 10,000 顯示為「X.X 萬」（保留一位小數，>= 10 萬則整數） */
export function fmtWan(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v as number)) return '—';
  const abs = Math.abs(v as number);
  if (abs < 10000) return Math.round(v as number).toLocaleString();
  const wan = (v as number) / 10000;
  const digits = Math.abs(wan) >= 100 ? 0 : 1;
  return `${wan.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} 萬`;
}

/**
 * 報酬條計算：共用 ±40% 尺規。回傳 0-1 之條長比例與是否破表。
 * 正向由中線向右、負向由中線向左；abs 超過 40 拉滿 + 標破表記號 ▸。
 */
export function clampReturnBar(pct: number, scale = 40): { ratio: number; over: boolean; sign: 1 | -1 | 0 } {
  if (pct == null || Number.isNaN(pct) || pct === 0) return { ratio: 0, over: false, sign: 0 };
  const abs = Math.abs(pct);
  const over = abs > scale;
  const ratio = Math.min(abs, scale) / scale;
  return { ratio, over, sign: pct > 0 ? 1 : -1 };
}

/** 天數差（正整數） */
export function daysBetween(start: Date | string | number, end: Date | string | number = Date.now()): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.max(0, Math.floor((e - s) / 86400000));
}

/** YYYY/MM/DD */
export function fmtDate(d: Date | string | number): string {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/** MM/DD */
export function fmtMD(d: Date | string | number): string {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
}

export const MINUS_SIGN = MINUS;
