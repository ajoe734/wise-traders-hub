import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MENTOR_PLAN_COPY, publicSystemName } from '@/lib/complianceCopy';

const profileSource = readFileSync(resolve(process.cwd(), 'src/pages/ExpertProfile.tsx'), 'utf8');
const panelSource = readFileSync(resolve(process.cwd(), 'src/components/strategy/PerformanceOverviewPanel.tsx'), 'utf8');

describe('公開老師詳情頁契約', () => {
  it('mentor 方案只使用中央中性文案', () => {
    expect(MENTOR_PLAN_COPY).toEqual({
      name: '修煉派',
      label: '每週固定公開｜當週操作復盤＋下週觀察框架',
      features: ['當週操作復盤', '判斷依據', '研究清單、觀察條件、風險情境'],
      note: '內容依平台固定週次公開；教學研究用途，非買賣建議',
    });
    expect(profileSource).not.toMatch(/T\+7|下週出手|保證|目標價/);
    expect(profileSource).toContain("plan.planType === 'mentor_weekly_journal' ? MENTOR_PLAN_COPY.name : plan.name");
    expect(profileSource).toContain("plan.planType !== 'mentor_weekly_journal' && plan.description");
  });

  it('email-shaped system_name fail-closed，合法名稱保留', () => {
    expect(publicSystemName(' a0927612131@gmail.com ')).toBe('尚未命名');
    expect(publicSystemName('mentor@example.com')).toBe('尚未命名');
    expect(publicSystemName(' 趨勢突破交易系統 ')).toBe('趨勢突破交易系統');
    expect(publicSystemName('')).toBe('尚未命名');
    expect(profileSource).toContain('publicSystemName(expertInfo.strategyName)');
  });

  it('績效 loading/error/empty/ready 不以假 0 代替', () => {
    expect(panelSource).toContain("? '績效資料載入中'");
    expect(panelSource).toContain("? NO_PUBLIC_RECORD");
    expect(panelSource).toContain(": '資料暫時無法取得'");
    expect(panelSource).toContain('!projection.showNumbers || isError');
    expect(panelSource).toContain('totalTrades <= 0');
    expect(panelSource).not.toMatch(/usePeriodPerformance|trade_records|expert_signals/);
  });

  it('parent 無條件 mount 四態 panel，不被 lazy observer 或 parent state 擋掉', () => {
    const performanceSection = profileSource.slice(
      profileSource.indexOf('{/* ── Performance Section ── */}'),
      profileSource.indexOf('{/* ── Plans Section ── */}'),
    );

    expect(performanceSection).toContain('<PerformanceOverviewPanel');
    expect(performanceSection).toContain('expertId={expertInfo.id}');
    expect(performanceSection).not.toMatch(/LazyOnVisible|Suspense|evidenceState|&&\s*\(\s*<PerformanceOverviewPanel/);
    expect(profileSource).not.toMatch(/const \[evidenceState|handleEvidenceState/);
  });

  it('checkout 保留真實 slug、plan id 與白名單 UTM', () => {
    expect(profileSource).toContain("preserveUtm(`/checkout/${slug}/${plan.id}`, search)");
    expect(profileSource).toContain('NT$ {formatPrice(plan.priceMonthly)}');
  });
});