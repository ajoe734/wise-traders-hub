import { describe, it, expect } from 'vitest';
import {
  allCopyStrings,
  BANNED_TERMS,
  cadenceLabel,
  GENERIC_CADENCE,
  DELIVERY_STRUCTURE,
  SAMPLE_STRUCTURE_FIELDS,
  NO_PUBLIC_RECORD,
} from '@/lib/complianceCopy';

describe('complianceCopy', () => {
  it('每個對外字串都不含禁用字', () => {
    const offenders: string[] = [];
    for (const s of allCopyStrings()) {
      for (const term of BANNED_TERMS) {
        if (s.includes(term)) offenders.push(`${term} @ ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('cadenceLabel: 台股 → 每週五 20:00', () => {
    expect(cadenceLabel('tw_stock')).toBe('每週五 20:00');
    expect(cadenceLabel('tw_futures')).toBe('每週五 20:00');
  });

  it('cadenceLabel: 美股／美股選擇權 → 每週六 08:00', () => {
    expect(cadenceLabel('us_stock')).toBe('每週六 08:00');
    expect(cadenceLabel('us_option')).toBe('每週六 08:00');
  });

  it('cadenceLabel: 無 assetClass → 通用句，不得硬寫週五 20:00', () => {
    expect(cadenceLabel(null)).toBe(GENERIC_CADENCE);
    expect(cadenceLabel(undefined)).toBe(GENERIC_CADENCE);
    expect(cadenceLabel('')).toBe(GENERIC_CADENCE);
    expect(GENERIC_CADENCE).not.toMatch(/20:00|08:00/);
  });

  it('交付結構為三卡：復盤／觀察框架／風險條件', () => {
    expect(DELIVERY_STRUCTURE.map((d) => d.key)).toEqual(['review', 'forward', 'risk']);
    expect(DELIVERY_STRUCTURE[0].title).toBe('當週操作復盤');
    expect(DELIVERY_STRUCTURE[1].title).toBe('下週觀察框架');
  });

  it('結構樣本只有欄位名稱，不含任何數字內容', () => {
    for (const f of SAMPLE_STRUCTURE_FIELDS) {
      expect(f).not.toMatch(/\d/);
    }
  });

  it('empty 狀態文案不含 0', () => {
    expect(NO_PUBLIC_RECORD).toBe('尚無可公開紀錄');
    expect(NO_PUBLIC_RECORD).not.toMatch(/\d/);
  });
});
