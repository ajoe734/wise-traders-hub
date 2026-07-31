/**
 * Group 1.36 — 純教學週記 / hold 觀察 端對端整合測試
 *
 * 對應實作（上一輪 PR）：
 *   - DB enum signal_action 新增 'teaching' / 'hold'
 *   - src/pages/_signalEditor/derive.ts buildTeachingOnlyRow / buildPublishRows
 *   - src/pages/admin/SignalEditor.tsx weekType toggle + canPublish 守門
 *   - supabase/functions/publish-weekly-journals/index.ts skip trade_signals/user_performances
 *
 * 測試範圍：
 *   A. derive.ts 純函數：buildTeachingOnlyRow / buildPublishRows
 *   B. drift-detection: publish-weekly-journals 對 teaching / hold 的 skip 分支
 *   C. drift-detection: SignalEditor 的 weekType toggle 與 canPublish 守門
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildTeachingOnlyRow, buildPublishRows } from '@/pages/_signalEditor/derive';
import type { TradeDraft } from '@/pages/_signalEditor/types';

// ── A. derive.ts 純函數 ─────────────────────────────────────────────

let _uid = 0;
const baseTrade = (over: Partial<TradeDraft> = {}): TradeDraft => ({
  uid: `t-${++_uid}`,
  stockCode: '',
  stockName: '',
  action: '' as any,
  quantity: '',
  quantityUnit: '張',
  priceHint: '',
  executedAt: '2026-06-20T09:00',
  reasonSummary: '',
  reasonDetail: '',
  riskNotes: '',
  ...over,
});

describe('buildTeachingOnlyRow（純教學週記 row 建構）', () => {
  it('回傳恰好 1 筆 row、action=teaching、instrument 為空字串、price/quantity/unit 皆為 null', () => {
    const rows = buildTeachingOnlyRow({
      expertId: 'expert-1',
      batchId: 'batch-1',
      status: 'pending',
      teachingTopic: '本週主題：均線多頭排列辨識',
      overallSummary: '本週重點…',
      learningPoints: '學員可學到…',
    });

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.action).toBe('teaching');
    expect(r.instrument).toBe('');
    expect(r.price_hint).toBeNull();
    expect(r.quantity).toBeNull();
    expect(r.quantity_unit).toBeNull();
    expect(r.expert_id).toBe('expert-1');
    expect(r.batch_id).toBe('batch-1');
    expect(r.status).toBe('pending');
    expect(r.teaching_topic).toBe('本週主題：均線多頭排列辨識');
  });

  it('teachingTopic 為空字串 → teaching_topic fallback 為 null', () => {
    const rows = buildTeachingOnlyRow({
      expertId: 'expert-1',
      batchId: 'batch-1',
      status: 'pending',
      teachingTopic: '',
      overallSummary: '',
      learningPoints: '',
    });
    expect(rows[0].teaching_topic).toBeNull();
    expect(rows[0].overall_summary).toBeNull();
    expect(rows[0].learning_points).toBeNull();
  });

  it('純教學週記 row 不應產生 trade-related 欄位（reason_summary/detail/risk 皆 null）', () => {
    const rows = buildTeachingOnlyRow({
      expertId: 'expert-1',
      batchId: 'batch-1',
      status: 'pending',
      teachingTopic: '主題',
      overallSummary: '',
      learningPoints: '',
    });
    expect(rows[0].reason_summary).toBeNull();
    expect(rows[0].reason_detail).toBeNull();
    expect(rows[0].risk_notes).toBeNull();
  });
});

describe('buildPublishRows（hold 觀察分支）', () => {
  it('hold action：price/quantity 留空 → price_hint/quantity 為 null、quantity_unit 也為 null', () => {
    const rows = buildPublishRows({
      expertId: 'expert-1',
      batchId: 'batch-1',
      status: 'pending',
      isMentor: true,
      teachingTopic: '本週觀察：續抱',
      overallSummary: '',
      learningPoints: '',
      trades: [
        baseTrade({
          stockCode: '2330',
          stockName: '台積電',
          action: 'hold' as any,
          quantity: '',
          priceHint: '',
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.action).toBe('hold');
    expect(r.instrument).toBe('2330 台積電');
    expect(r.price_hint).toBeNull();
    expect(r.quantity).toBeNull();
    expect(r.quantity_unit).toBeNull();
    expect(r.teaching_topic).toBe('本週觀察：續抱');
  });

  it('hold + buy 混合：teaching_topic 只掛在原始 UI 第 1 筆，hold 不會被過濾', () => {
    const rows = buildPublishRows({
      expertId: 'expert-1',
      batchId: 'batch-1',
      status: 'pending',
      isMentor: true,
      teachingTopic: '本週重點',
      overallSummary: '摘要',
      learningPoints: '學習',
      trades: [
        baseTrade({
          stockCode: '2330',
          stockName: '台積電',
          action: 'hold' as any,
        }),
        baseTrade({
          stockCode: '2454',
          stockName: '聯發科',
          action: 'buy' as any,
          quantity: '10',
          priceHint: '1200',
        }),
      ],
    });

    // hold 與 buy 各一筆
    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['buy', 'hold']);

    // teaching_topic / overall_summary / learning_points 只能掛在原始 UI 第 0 筆（hold 那筆）
    const holdRow = rows.find((r) => r.action === 'hold')!;
    const buyRow = rows.find((r) => r.action === 'buy')!;
    expect(holdRow.teaching_topic).toBe('本週重點');
    expect(holdRow.overall_summary).toContain('摘要');
    expect(holdRow.learning_points).toContain('學習');
    expect(buyRow.teaching_topic).toBeNull();
    expect(buyRow.overall_summary).toBeNull();
    expect(buyRow.learning_points).toBeNull();
  });

  it('hold action 帶有部分數量 → 仍保留該值（容許分析師選擇性填寫）', () => {
    const rows = buildPublishRows({
      expertId: 'expert-1',
      batchId: 'batch-1',
      status: 'pending',
      isMentor: true,
      teachingTopic: '',
      overallSummary: '',
      learningPoints: '',
      trades: [
        baseTrade({
          stockCode: '2330',
          stockName: '台積電',
          action: 'hold' as any,
          quantity: '5',
          priceHint: '',
        }),
      ],
    });
    expect(rows[0].quantity).toBe(5);
    expect(rows[0].quantity_unit).toBe('張');
    expect(rows[0].price_hint).toBeNull();
  });
});

// ── B. drift-detection: publish-weekly-journals ────────────────────

describe('drift-detection: publish-weekly-journals 對 teaching / hold 的 skip 分支', () => {
  let src: string;

  beforeAll(() => {
    // 發布流程已拆成 index（認證/scope）+ pipeline（階段實作）
    const dir = resolve(process.cwd(), 'supabase/functions/publish-weekly-journals');
    src = ['index.ts', 'pipeline.ts', 'supabasePort.ts']
      .map((f) => readFileSync(resolve(dir, f), 'utf-8'))
      .join('\n');
  });


  it('sync_trade_signals 階段第一個守門：teaching / hold 直接 continue（不打 trade_signals / user_performances）', () => {
    // 必要關鍵字
    expect(src).toContain("signal.action === 'teaching'");
    expect(src).toContain("signal.action === 'hold'");

    // 找到 skip 區塊：包含「teaching / hold」判斷 + continue
    const skipBlock = src.match(
      /signal\.action === 'teaching'[\s\S]{0,200}continue/,
    );
    expect(
      skipBlock,
      'teaching/hold 應在 sync_trade_signals 開頭就 continue，未找到 skip 區塊',
    ).toBeTruthy();
  });

  it('expert_signals pending → published 主流程不受 teaching/hold 影響（既有行為）', () => {
    expect(src).toContain('expert_signals');
    expect(src).toContain("status: 'published'");
    expect(src).toContain("'pending'");
  });

  it('skip 區塊出現在所有 trade_signals / user_performances 操作之前', () => {
    const skipIdx = src.indexOf("signal.action === 'teaching'");
    const firstTradeSignalsIdx = src.indexOf(
      "from('trade_signals')",
      src.indexOf("stage = 'sync_trade_signals'"),
    );
    const firstUserPerfIdx = src.indexOf(
      "from('user_performances')",
      src.indexOf("stage = 'sync_trade_signals'"),
    );
    expect(skipIdx).toBeGreaterThan(0);
    expect(firstTradeSignalsIdx).toBeGreaterThan(skipIdx);
    expect(firstUserPerfIdx).toBeGreaterThan(skipIdx);
  });
});

// ── C. 行為級測試：發布守門（P8，取代原字串比對 drift-detection） ──
//
// 守門順序改由純函式 evaluatePublishGate 決定，行為在 publishGate.test.ts 完整覆蓋。
// 這裡只保留兩件事：
//   (1) SignalEditor 真的走 evaluatePublishGate（不再自己 inline 判斷）
//   (2) teaching / trades 兩條路徑的行為結果（用純函式驗，不比對原始碼字串）

describe('發布守門（evaluatePublishGate）在 teaching / trades 兩條路徑的行為', () => {
  const gateBase = {
    canEdit: true,
    publishWindow: { open: true },
    assetClass: 'tw_stock',
    teachingTopic: '',
    validateBatch: () => null as string | null,
  };

  it('純教學週記：缺教學主題 → 阻擋且不觸發交易驗證', () => {
    let validated = false;
    const r = evaluatePublishGate({
      ...gateBase,
      isTeachingOnly: true,
      validateBatch: () => { validated = true; return null; },
    });
    expect(r.blocked).toBe(true);
    expect(r.code).toBe('TEACHING_TOPIC_REQUIRED');
    expect(validated).toBe(false);
  });

  it('純教學週記：有主題 → 放行，交易驗證錯誤不影響', () => {
    const r = evaluatePublishGate({
      ...gateBase,
      isTeachingOnly: true,
      teachingTopic: '本週主題',
      validateBatch: () => '交易資料有誤',
    });
    expect(r.blocked).toBe(false);
  });

  it('交易週記：走 validateSignalBatch，錯誤訊息原樣回傳', () => {
    const r = evaluatePublishGate({
      ...gateBase,
      isTeachingOnly: false,
      validateBatch: () => '第 1 筆缺少股票代號',
    });
    expect(r).toMatchObject({ blocked: true, code: 'BATCH_INVALID', reason: '第 1 筆缺少股票代號' });
  });

  it('發布時段未開先於資產類別與內容檢查', () => {
    const r = evaluatePublishGate({
      ...gateBase,
      publishWindow: { open: false, reason: '台股需等到週五 20:00' },
      assetClass: null,
      isTeachingOnly: true,
    });
    expect(r.code).toBe('WINDOW_CLOSED');
  });
});

describe('SignalEditor 接線：weekType toggle 與守門委派', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      resolve(process.cwd(), 'src/pages/admin/SignalEditor.tsx'),
      'utf-8',
    );
  });

  it('保留 weekType state 與 isTeachingOnly（mentor + teaching）', () => {
    expect(src).toMatch(/weekType,\s*setWeekType/);
    expect(src).toMatch(/isMentor && weekType === 'teaching'/);
  });

  it('handlePublish 委派給 evaluatePublishGate，不再 inline 手刻守門', () => {
    expect(src).toContain('evaluatePublishGate');
    // 舊的 inline 判斷必須已移除，避免兩套守門並存
    expect(src).not.toMatch(/純教學週記至少要填教學主題/);
    expect(src).not.toMatch(/if \(!publishWindow\.open\) \{/);
  });

  it('isTeachingOnly 時使用 buildTeachingOnlyRow 而非 buildPublishRows', () => {
    expect(src).toMatch(
      /isTeachingOnly[\s\S]{0,80}buildTeachingOnlyRow[\s\S]{0,400}buildPublishRows/,
    );
  });

  it('UI 提供「純教學週記（無交易）」切換按鈕', () => {
    expect(src).toContain('純教學週記（無交易）');
  });
});


// ── D. drift-detection: derive.ts hold 在 validate / 模擬中正確處理 ──

describe('drift-detection: derive.ts hold action 在驗證與模擬中的處理', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      resolve(process.cwd(), 'src/pages/_signalEditor/derive.ts'),
      'utf-8',
    );
  });

  it('validateSignalBatch：hold 跳過 quantity/price 必填檢查（continue）', () => {
    expect(src).toMatch(
      /if \(t\.action === 'hold'\) continue;[\s\S]{0,200}qty[\s\S]{0,150}請填\$\{t\.isCombo \? '組數' : '數量'\}/,
    );
  });


  it('validateSignalBatch：hold 需既有持倉，否則拋錯阻擋送出', () => {
    expect(src).toContain('尚無');
    expect(src).toContain('無法寫「觀察」週記');
  });

  it('buildPublishRows：hold 時 price_hint / quantity 允許為 null', () => {
    expect(src).toMatch(/const isHold = t\.action === 'hold'/);
    expect(src).toMatch(/isHold \? priceHint : parseFloat/);
    expect(src).toMatch(/isHold \? quantity : parseInt/);
  });

  it('EXEC_ORDER 包含 hold 與 teaching（穩定排序，避免 undefined 排到最後）', () => {
    expect(src).toMatch(/hold:\s*\d+/);
    expect(src).toMatch(/teaching:\s*\d+/);
  });
});
