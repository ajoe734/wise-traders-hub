import { describe, it, expect } from 'vitest';
import {
  deriveIdentity, deriveValuation, deriveSparkline, deriveThesisSentence,
  deriveRelatedEvents, deriveHoldContext, deriveTargetPriceTrend, deriveThesisRows,
  deriveDecisionStamp, deriveNeighbors, buildSimInput, deriveDisplayNumbers,
  shapeTargetPriceHistory, shapeThesisTracking, formatStamp, formatTodayLabel,
  deriveHoldingDetailViewModel, getSparkCloses, getSparkOhlc,
} from '../holdingDetailViewModel';


const H = { code: '2330', name: '台積電', cost: 900, price: 1000, qty: 2000, pct: 11.11, pnl: 200000 };

describe('deriveIdentity', () => {
  it('帶出 meta 的產業／策略／價格來源', () => {
    expect(deriveIdentity(H, { industry: '半導體', strategy: '長抱', priceSource: 'twse' }))
      .toEqual({ code: '2330', name: '台積電', industry: '半導體', strategy: '長抱', priceSource: 'twse' });
  });
  it('無 meta 時全為 null', () => {
    expect(deriveIdentity(H, null).industry).toBeNull();
  });
});

describe('deriveValuation', () => {
  it('value 缺漏時以 price × qty 回推', () => {
    const v = deriveValuation(H, 4_000_000);
    expect(v.valueNum).toBe(2_000_000);
    expect(v.weightPct).toBe(50);
  });
  it('總市值為 0 時權重為 null', () => {
    expect(deriveValuation(H, 0).weightPct).toBeNull();
  });
  it('非數字的今日漲跌一律 null', () => {
    expect(deriveValuation({ ...H, changePct: 'x' }, 1).todayPct).toBeNull();
  });
  it('相容 totalPct / totalPnl 舊欄位', () => {
    const v = deriveValuation({ totalPct: 5, totalPnl: 100 }, 0);
    expect(v.pctVal).toBe(5);
    expect(v.pnlVal).toBe(100);
  });
});

describe('deriveSparkline', () => {
  it('真實資料 ≥2 點時原樣使用', () => {
    expect(deriveSparkline([1, 2, 3], H)).toEqual([1, 2, 3]);
  });
  it('接受 { closes } 物件並取收盤序列', () => {
    expect(deriveSparkline({ closes: [1, 2, 3], ohlc: [] }, H)).toEqual([1, 2, 3]);
  });
  it('資料不足時以成本→現價補 30 點且尾端等於現價', () => {
    const arr = deriveSparkline([], H);
    expect(arr).toHaveLength(30);
    expect(arr[29]).toBe(1000);
  });
  it('同一檔股票的偽序列是決定性的', () => {
    expect(deriveSparkline([], H)).toEqual(deriveSparkline([], H));
  });
  it('成本或現價無效時不編造資料', () => {
    expect(deriveSparkline([], { code: 'X', cost: 0, price: 0 })).toEqual([]);
  });
});


describe('getSparkCloses / getSparkOhlc', () => {
  it('向下相容純數字陣列', () => {
    expect(getSparkCloses([1, 2, null as any, 4])).toEqual([1, 2, 4]);
    expect(getSparkOhlc([1, 2, 3])).toEqual([]);
  });
  it('從 { closes, ohlc } 物件各取陣列', () => {
    const data = {
      closes: [100, 101, null, 103],
      ohlc: [
        { open: 100, high: 105, low: 99, close: 101 },
        { open: 101, high: 0, low: 0, close: 0 }, // high=0 過濾掉
      ],
    };
    expect(getSparkCloses(data)).toEqual([100, 101, 103]);
    expect(getSparkOhlc(data)).toEqual([{ open: 100, high: 105, low: 99, close: 101 }]);
  });
  it('空 / null 安全', () => {
    expect(getSparkCloses(null)).toEqual([]);
    expect(getSparkCloses(undefined)).toEqual([]);
    expect(getSparkOhlc(null)).toEqual([]);
  });
});


describe('deriveThesisSentence', () => {
  it('取第一個句子', () => {
    expect(deriveThesisSentence({ actionText: '先減碼。之後再看。' }, null)).toBe('先減碼。');
  });
  it('沒有 decision 時退回 meta.strategy', () => {
    expect(deriveThesisSentence(null, { strategy: '長抱' })).toBe('長抱');
  });
  it('上限 90 字', () => {
    expect(deriveThesisSentence({ actionText: 'a'.repeat(200) }, null)).toHaveLength(90);
  });
});

describe('deriveRelatedEvents', () => {
  const events = [
    { id: 1, relatedCodes: ['2330'], source: 'twse' },
    { id: 2, relatedCodes: ['2330'], source: 'demo' },
    { id: 3, relatedCodes: ['2317'], source: 'twse' },
  ];
  it('只留本檔且排除 demo', () => {
    expect(deriveRelatedEvents(events, '2330').map((e: any) => e.id)).toEqual([1]);
  });
  it('最多 5 筆', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: i, relatedCodes: ['2330'], source: 'x' }));
    expect(deriveRelatedEvents(many, '2330')).toHaveLength(5);
  });
});

describe('deriveHoldContext', () => {
  const today = new Date();
  const iso = (d: number) => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
  it('計算持有天數、加碼次數與最近動作', () => {
    const ctx: any = deriveHoldContext([
      { code: '2330', date: iso(10), action: 'buy' },
      { code: '2330', date: iso(3), action: 'add' },
    ], '2330');
    expect(ctx.heldDays).toBeGreaterThanOrEqual(9);
    expect(ctx.addCount).toBe(1);
    expect(ctx.lastLabel).toContain('加碼');
  });
  it('無有效日期時回 null', () => {
    expect(deriveHoldContext([{ code: '2330', date: 'bad' }], '2330')).toBeNull();
  });
  it('沒有本檔紀錄時回 null', () => {
    expect(deriveHoldContext([{ code: '2317', date: iso(1) }], '2330')).toBeNull();
  });
});

describe('deriveTargetPriceTrend', () => {
  it('上修時給 ↑ 與變動幅度', () => {
    const t: any = deriveTargetPriceTrend({ '2330': [
      { date: '2026-01-01', target: 1000 }, { date: '2026-03-01', target: 1200 },
    ] }, '2330');
    expect(t.arrow).toBe('↑');
    expect(Math.round(t.deltaPct)).toBe(20);
    expect(t.spanDays).toBe(59);
  });
  it('變動小於 1% 視為未修正', () => {
    expect(deriveTargetPriceTrend({ '2330': [
      { date: '2026-01-01', target: 1000 }, { date: '2026-02-01', target: 1005 },
    ] }, '2330')).toBeNull();
  });
  it('少於兩筆回 null', () => {
    expect(deriveTargetPriceTrend({ '2330': [{ date: '2026-01-01', target: 1000 }] }, '2330')).toBeNull();
  });
});

describe('deriveThesisRows', () => {
  it('取最近 8 筆並正規化欄位', () => {
    const rows: any = deriveThesisRows({ '2330': Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-0${i % 9}`, action: 'hold', userAction: '續抱', afterPct: 'x',
    })) }, '2330');
    expect(rows).toHaveLength(8);
    expect(rows[0].suggestion).toBe('hold');
    expect(rows[0].myAction).toBe('續抱');
    expect(rows[0].afterPct).toBeNull();
  });
  it('無資料回 null', () => {
    expect(deriveThesisRows(null, '2330')).toBeNull();
  });
});

describe('deriveDecisionStamp', () => {
  it('出場＋立即會標 accent', () => {
    expect(deriveDecisionStamp({ actionType: 'exit', urgency: 'now' }))
      .toMatchObject({ actionKind: 'exit', actionLabel: '出場', urgencyLabel: '立即', urgencyAccent: true });
  });
  it('未知值退回續抱／低', () => {
    expect(deriveDecisionStamp(undefined))
      .toMatchObject({ actionLabel: '續抱', urgencyLabel: '低', urgencyAccent: false });
  });
});

describe('deriveNeighbors', () => {
  const list = [{ code: 'A' }, { code: 'B' }, { code: 'C' }];
  it('中間項有前後', () => {
    expect(deriveNeighbors(list, 'B')).toEqual({ prev: { code: 'A' }, next: { code: 'C' } });
  });
  it('頭尾各缺一邊', () => {
    expect(deriveNeighbors(list, 'A').prev).toBeNull();
    expect(deriveNeighbors(list, 'C').next).toBeNull();
  });
  it('不在清單中時兩邊都 null', () => {
    expect(deriveNeighbors(list, 'Z')).toEqual({ prev: null, next: null });
  });
});

describe('buildSimInput', () => {
  it('空字串目標價沿用基準價而非 0', () => {
    expect(buildSimInput(H, { target: '', deltaQty: 0, buyMorePrice: '', stopPrice: '' }, 1200))
      .toMatchObject({ target: 1200, buyMorePrice: null, stopPrice: null, cost: 900, qty: 2000 });
  });
  it('填值時採用使用者輸入', () => {
    expect(buildSimInput(H, { target: '1500', deltaQty: '-1000', buyMorePrice: '950', stopPrice: '800' }, 1200))
      .toMatchObject({ target: 1500, deltaQty: -1000, buyMorePrice: 950, stopPrice: 800 });
  });
});

describe('deriveDisplayNumbers', () => {
  const valuation = deriveValuation(H, 4_000_000);
  it('未模擬時用原始數字', () => {
    const d = deriveDisplayNumbers({
      holding: H, sim: { target: '' }, scenario: {}, dirty: false,
      baseTarget: 1200, valuation, totalPortfolioValue: 4_000_000,
    });
    expect(d.displayPnlPct).toBe(11.11);
    expect(d.displayTarget).toBe(1200);
    expect(Math.round(d.displayUpside!)).toBe(20);
  });
  it('模擬生效時改用 scenario 值並重算權重', () => {
    const d = deriveDisplayNumbers({
      holding: H, sim: { target: '1500' },
      scenario: { simPnlPct: 30, simPnlAbs: 500000, simQty: 3000, simValue: 3_000_000 },
      dirty: true, baseTarget: 1200, valuation, totalPortfolioValue: 4_000_000,
    });
    expect(d.displayTarget).toBe(1500);
    expect(d.displayPnlPct).toBe(30);
    expect(d.displayWeight).toBe(75);
  });
});

describe('shape*', () => {
  it('目標價歷史過濾無效列', () => {
    expect(shapeTargetPriceHistory([
      { report_date: '2026-01-01', target: 100 },
      { report_date: null, created_at: '2026-02-02T00:00:00Z', target: 200 },
      { report_date: '2026-03-03', target: 0 },
    ], '2330')).toEqual({ '2330': [
      { date: '2026-01-01', target: 100 }, { date: '2026-02-02', target: 200 },
    ] });
  });
  it('目標價歷史空陣列回 null', () => {
    expect(shapeTargetPriceHistory([], '2330')).toBeNull();
  });
  it('論點追蹤攤平 reviewHistory 並依日期排序', () => {
    const out: any = shapeThesisTracking([{ stockId: '2330', reviewHistory: [
      { timestamp: '2026-03-01T00:00:00Z', suggestion: 'hold' },
      { date: '2026-01-01', decision: 'exit', afterPct: 5 },
      { suggestion: 'no-date' },
    ] }], '2330');
    expect(out['2330'].map((r: any) => r.date)).toEqual(['2026-01-01', '2026-03-01']);
    expect(out['2330'][0].suggestion).toBe('exit');
  });
  it('沒有本檔論點回 null', () => {
    expect(shapeThesisTracking([{ stockId: '2317', reviewHistory: [] }], '2330')).toBeNull();
  });
});

describe('時間戳格式', () => {
  const d = new Date(2026, 6, 5, 9, 8);
  it('stamp 為 YYYY/MM/DD HH:mm', () => expect(formatStamp(d)).toBe('2026/07/05 09:08'));
  it('todayLabel 為 MM／DD', () => expect(formatTodayLabel(d)).toBe('07／05'));
});

describe('deriveHoldingDetailViewModel', () => {
  it('一次組出所有區塊', () => {
    const vm = deriveHoldingDetailViewModel({
      holding: H,
      decision: { actionType: 'review', urgency: 'soon', actionText: '留意法說。' },
      meta: { industry: '半導體' },
      baseTarget: 1200,
      totalPortfolioValue: 4_000_000,
      normalizedEvents: [{ relatedCodes: ['2330'], source: 'twse', title: '法說會' }],
      orderedDisplayed: [{ code: '1101' }, { code: '2330' }],
      now: new Date(2026, 0, 2, 3, 4),
    });
    expect(vm.identity.name).toBe('台積電');
    expect(vm.decisionStamp.actionLabel).toBe('檢視');
    expect(vm.neighbors.prev).toEqual({ code: '1101' });
    expect(vm.neighbors.next).toBeNull();
    expect(vm.nextEvent).toMatchObject({ title: '法說會' });
    expect(vm.thesisSentence).toBe('留意法說。');
    expect(vm.valuation.weightPct).toBe(50);
    expect(vm.rangeHigh).toBe(Math.max(...vm.sparkArr));
    expect(vm.stamp).toBe('2026/01/02 03:04');
  });

  it('空持股不會炸，回傳安全預設', () => {
    const vm = deriveHoldingDetailViewModel({ holding: null });
    expect(vm.identity.code).toBeNull();
    expect(vm.holdContext).toBeNull();
    expect(vm.thesisRows).toBeNull();
    expect(vm.sparkArr).toEqual([]);
    expect(vm.decisionStamp.actionLabel).toBe('續抱');
  });
});
