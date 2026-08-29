import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildManualTradeRow,
  validateManualDraft,
} from '@/checkup/lib/manualTradeEntry';
import { normalizeStockCode, classifyCode, qtyRuleFor } from '@/checkup/lib/stockIdentity';
import { resolveStockName } from '@/lib/stockNameResolver';

/**
 * ManualTradeForm — 手動輸入單筆成交。
 *
 * 憲法（PLAN_V4.1）：
 *   - 本元件**不提交任何東西**。唯一輸出是 `onAdd(row)`，把 exact 12-key row
 *     append 進 TradeTab 既有的 `parsed.trades` preview 清單，
 *     之後與 OCR 列共用同一個 `applyCorrections` 管線。
 *   - draft 專屬欄位（`nameDirty`）只活在本元件 state，`buildManualTradeRow`
 *     的白名單會 strip 掉，不會流進 row / tradeLog / DB。
 *   - 名稱解析用 sequence token 防 race：舊 promise 後到一律丟棄。
 */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowHHmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const emptyDraft = () => ({
  action: '買進',
  code: '',
  name: '',
  nameDirty: false,
  qty: '',
  price: '',
  date: todayISO(),
  time: nowHHmm(),
});

export default function ManualTradeForm({ C, alpha, card, lbl, isDemo, onAdd, holdingsCount = 0, maxHoldings = 50 }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [touched, setTouched] = useState(false);
  const [resolving, setResolving] = useState(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const errors = validateManualDraft(draft);
  const errOf = (field) => (touched ? errors.find((e) => e.field === field)?.message : undefined);
  // 不用 disabled 擋：按下去才顯示欄位錯誤，否則使用者看不到「為什麼不能加入」。
  const canSubmit = errors.length === 0 && !isDemo;
  const clickable = !isDemo;
  const qtyRule = qtyRuleFor(draft.code);
  const market = classifyCode(draft.code);

  /** code 變更 → 立即清空未經使用者編輯的 name，再非同步解析。 */
  const onCodeChange = useCallback((raw) => {
    const code = normalizeStockCode(raw);
    const seq = ++seqRef.current;
    setDraft((prev) => ({ ...prev, code, name: prev.nameDirty ? prev.name : '' }));
    if (classifyCode(code) === 'unknown') { setResolving(false); return; }
    setResolving(true);
    Promise.resolve()
      .then(() => resolveStockName(code))
      .then((name) => {
        // race guard：只有最後一次輸入的結果能落地
        if (!mountedRef.current || seq !== seqRef.current) return;
        setResolving(false);
        setDraft((prev) => {
          if (prev.nameDirty || prev.code !== code) return prev;
          return { ...prev, name: name || code };
        });
      })
      .catch(() => {
        if (!mountedRef.current || seq !== seqRef.current) return;
        setResolving(false);
        setDraft((prev) => (prev.nameDirty || prev.code !== code ? prev : { ...prev, name: code }));
      });
  }, []);

  const submit = () => {
    setTouched(true);
    if (errors.length > 0 || isDemo) return;
    onAdd(buildManualTradeRow(draft));
    setDraft((prev) => ({ ...emptyDraft(), action: prev.action, date: prev.date }));
    setTouched(false);
  };

  const inputStyle = (field) => ({
    width: '100%',
    background: C.subtle,
    border: `1px solid ${errOf(field) ? C.down : C.border}`,
    borderRadius: 7,
    padding: '8px 10px',
    color: C.text,
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
  });
  const fieldLabel = { fontSize: 12, color: C.textMute, marginBottom: 3 };
  const errText = (field) => errOf(field) && (
    <div role="alert" style={{ fontSize: 11, color: C.down, marginTop: 3, lineHeight: 1.6 }}>{errOf(field)}</div>
  );

  return (
    <div style={{ ...card, borderLeft: `2px solid ${alpha(C.amber, '88')}` }}>
      <div style={lbl}>手動輸入成交</div>
      <div style={{ fontSize: 13, color: C.textMute, marginBottom: 12, lineHeight: 1.6 }}>
        沒有截圖時可直接輸入。加入後會與截圖解析結果並列在同一份清單，最後一起確認。
      </div>

      {isDemo && (
        <div style={{ fontSize: 12, color: C.textMute, marginBottom: 10, lineHeight: 1.6 }}>
          Demo 模式無法新增成交，請先登入。
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {['買進', '賣出'].map((a) => {
          const on = draft.action === a;
          const tone = a === '買進' ? C.up : C.down;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => setDraft((p) => ({ ...p, action: a }))}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 7,
                border: `1px solid ${on ? alpha(tone, '88') : C.border}`,
                background: on ? alpha(tone, '12') : 'transparent',
                color: on ? tone : C.textMute,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >{a}</button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 7 }}>
        <div>
          <div style={fieldLabel}>股票代碼</div>
          <input
            aria-label="股票代碼"
            aria-invalid={!!errOf('code')}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            placeholder="如 2330 / 00637L / AMD"
            value={draft.code}
            onChange={(e) => onCodeChange(e.target.value)}
            style={inputStyle('code')}
          />
          {errText('code')}
          {!errOf('code') && market !== 'unknown' && (
            <div style={{ fontSize: 11, color: C.textMute, marginTop: 3 }}>
              {market === 'TW' ? '台股' : '美股'}
              {resolving ? '・查詢名稱中…' : draft.name ? `・${draft.name}` : ''}
            </div>
          )}
        </div>
        <div>
          <div style={fieldLabel}>股票名稱</div>
          <input
            aria-label="股票名稱"
            aria-invalid={!!errOf('name')}
            type="text"
            inputMode="text"
            maxLength={40}
            placeholder="自動帶入，可修改"
            value={draft.name}
            onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value, nameDirty: true }))}
            style={inputStyle('name')}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 7 }}>
        <div>
          <div style={fieldLabel}>股數{qtyRule.integerOnly ? '（整數）' : '（可小數）'}</div>
          <input
            aria-label="股數"
            aria-invalid={!!errOf('qty')}
            type="text"
            inputMode={qtyRule.inputMode}
            step={qtyRule.step}
            placeholder={qtyRule.integerOnly ? '如 1000' : '如 0.5'}
            value={draft.qty}
            onChange={(e) => setDraft((p) => ({ ...p, qty: e.target.value }))}
            style={inputStyle('qty')}
          />
          {errText('qty')}
        </div>
        <div>
          <div style={fieldLabel}>成交價</div>
          <input
            aria-label="成交價"
            aria-invalid={!!errOf('price')}
            type="text"
            inputMode="decimal"
            step="0.01"
            enterKeyHint="done"
            placeholder="如 1102"
            value={draft.price}
            onChange={(e) => setDraft((p) => ({ ...p, price: e.target.value }))}
            style={inputStyle('price')}
          />
          {errText('price')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 12 }}>
        <div>
          <div style={fieldLabel}>成交日期</div>
          <input
            aria-label="成交日期"
            type="date"
            max={todayISO()}
            value={draft.date}
            onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))}
            style={inputStyle('date')}
          />
        </div>
        <div>
          <div style={fieldLabel}>成交時間</div>
          <input
            aria-label="成交時間"
            type="time"
            value={draft.time}
            onChange={(e) => setDraft((p) => ({ ...p, time: e.target.value }))}
            style={inputStyle('time')}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!clickable}
        aria-label="加入這筆成交"
        style={{
          width: '100%',
          padding: '11px',
          border: `1px solid ${canSubmit ? alpha(C.amber, '88') : C.border}`,
          borderRadius: 8,
          background: canSubmit ? alpha(C.amber, '14') : C.subtle,
          color: canSubmit ? C.text : C.textMute,
          fontSize: 14,
          fontWeight: 500,
          fontFamily: 'inherit',
          letterSpacing: '0.04em',
          cursor: clickable ? 'pointer' : 'not-allowed',
        }}
      >
        加入清單
      </button>
      <div style={{ fontSize: 11, color: C.textMute, marginTop: 8, letterSpacing: '0.04em' }}>
        持倉上限 {maxHoldings} 檔（目前 {holdingsCount} 檔）
      </div>
    </div>
  );
}
