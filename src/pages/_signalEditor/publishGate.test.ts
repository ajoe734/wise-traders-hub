import { describe, it, expect, vi } from 'vitest';
import {
  evaluatePublishGate,
  PUBLISH_GATE_MESSAGES,
  type PublishGateInput,
} from './publishGate';

const base = (over: Partial<PublishGateInput> = {}): PublishGateInput => ({
  canEdit: true,
  publishWindow: { open: true },
  assetClass: 'tw_stock',
  isTeachingOnly: false,
  teachingTopic: '',
  validateBatch: () => null,
  ...over,
});

describe('evaluatePublishGate — 守門順序與短路', () => {
  it('全部通過 → blocked=false', () => {
    expect(evaluatePublishGate(base())).toEqual({
      blocked: false, code: null, reason: null, silent: false,
    });
  });

  it('1. 無編輯權限最先擋，且 silent（不顯示 toast）', () => {
    const validateBatch = vi.fn(() => 'should not run');
    const r = evaluatePublishGate(
      base({ canEdit: false, publishWindow: { open: false }, assetClass: null, validateBatch }),
    );
    expect(r).toMatchObject({ blocked: true, code: 'NOT_EDITABLE', silent: true, reason: null });
    expect(validateBatch).not.toHaveBeenCalled();
  });

  it('2. 發布時段未開 → WINDOW_CLOSED，優先於 asset_class 檢查', () => {
    const r = evaluatePublishGate(
      base({ publishWindow: { open: false, reason: '台股週記需等到週五 20:00' }, assetClass: null }),
    );
    expect(r).toMatchObject({ blocked: true, code: 'WINDOW_CLOSED' });
    expect(r.reason).toBe('台股週記需等到週五 20:00');
  });

  it('2b. 時段未開但沒帶 reason → 使用預設文案', () => {
    const r = evaluatePublishGate(base({ publishWindow: { open: false } }));
    expect(r.reason).toBe(PUBLISH_GATE_MESSAGES.WINDOW_CLOSED);
  });

  it('3. 未設定 asset_class → NO_ASSET_CLASS，且不會跑 validateBatch', () => {
    const validateBatch = vi.fn(() => 'x');
    const r = evaluatePublishGate(base({ assetClass: '', validateBatch }));
    expect(r).toMatchObject({ blocked: true, code: 'NO_ASSET_CLASS' });
    expect(r.reason).toBe(PUBLISH_GATE_MESSAGES.NO_ASSET_CLASS);
    expect(validateBatch).not.toHaveBeenCalled();
  });

  it('4. 純教學週記缺教學主題（含只有空白）→ TEACHING_TOPIC_REQUIRED', () => {
    for (const topic of ['', '   ', '\n']) {
      const r = evaluatePublishGate(base({ isTeachingOnly: true, teachingTopic: topic }));
      expect(r).toMatchObject({ blocked: true, code: 'TEACHING_TOPIC_REQUIRED' });
    }
  });

  it('4b. 純教學週記有主題 → 通過，且完全跳過 validateSignalBatch', () => {
    const validateBatch = vi.fn(() => '交易資料有誤');
    const r = evaluatePublishGate(
      base({ isTeachingOnly: true, teachingTopic: '本週主題', validateBatch }),
    );
    expect(r.blocked).toBe(false);
    expect(validateBatch).not.toHaveBeenCalled();
  });

  it('5. 交易週記：validateSignalBatch 有錯 → BATCH_INVALID 並原樣帶出訊息', () => {
    const r = evaluatePublishGate(base({ validateBatch: () => '第 1 筆缺少股票代號' }));
    expect(r).toMatchObject({ blocked: true, code: 'BATCH_INVALID', silent: false });
    expect(r.reason).toBe('第 1 筆缺少股票代號');
  });

  it('5b. 交易週記：validateBatch 回 undefined 視為通過', () => {
    expect(evaluatePublishGate(base({ validateBatch: () => undefined })).blocked).toBe(false);
  });

  it('交易週記時 teachingTopic 為空不構成阻擋', () => {
    expect(evaluatePublishGate(base({ isTeachingOnly: false, teachingTopic: '' })).blocked).toBe(false);
  });
});
