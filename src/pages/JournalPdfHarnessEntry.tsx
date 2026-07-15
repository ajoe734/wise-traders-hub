// @ts-nocheck
/**
 * Preview-only E2E harness for exportJournalPdf 的 HTML 頁面。
 * 用固定 fixture 呼叫 renderJournalPageHtmls，把每頁 HTML 掛到
 * data-pdf-page 容器裡，讓 Playwright 直接對元素截圖做視覺回歸，
 * 不用真的產出 PDF。
 *
 * SECURITY: 僅在 preview / localhost 提供，正式站直接 return null。
 */
import { useEffect, useRef, useState } from 'react';
import {
  ensureJournalPdfFonts,
  renderJournalPageHtmls,
} from '@/lib/exportJournalPdf';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

const FIXTURE = {
  weekStart: new Date('2026-07-06T00:00:00+08:00'),
  weekEnd: new Date('2026-07-10T00:00:00+08:00'),
  weekTitle: '守住 AI 主流，減碼落後族群',
  avatarSrc: '',
  learningPoints: [
    '主流股回檔即是加碼點，非賣點',
    '落後補漲行情通常代表主流動能疲弱',
    '控制單一標的權重不超過總資產 25%',
  ],
  headSignal: {
    id: 'head',
    instrument: '2330 台積電',
    action: 'buy',
    price_hint: 1100,
    quantity: 1,
    quantity_unit: '張',
    reason_summary: '長線 AI 龍頭續強',
    reason_detail:
      '本週主流仍為 AI 半導體，代工龍頭於法說前呈現價量俱揚。\n持股續抱主流，落後族群減碼調整。',
    risk_notes: null,
    learning_points: null,
    published_at: '2026-07-07T09:15:00+08:00',
    experts: {
      name: '張大濤',
      slug: 'zhang-datao',
      role: 'mentor',
      avatar_url: null,
    },
  },
  weekSignals: [
    // 覆蓋 5 種 action，確保 badge 色票都被截到
    { action: 'buy', instrument: '2330 台積電', price: 1100 },
    { action: 'add', instrument: '2454 聯發科', price: 1500 },
    { action: 'trim', instrument: '2317 鴻海', price: 210 },
    { action: 'sell', instrument: '2603 長榮', price: 195 },
    { action: 'exit', instrument: '3008 大立光', price: 2400 },
  ].map((s, i) => ({
    id: `s-${i}`,
    instrument: s.instrument,
    action: s.action,
    price_hint: s.price,
    quantity: 1,
    quantity_unit: '張',
    reason_summary: '主流動能延續，訊號明確。',
    reason_detail: '依原策略執行部位控管，避免情緒單。',
    risk_notes: s.action === 'exit' ? '跌破停損位，紀律出場。' : null,
    learning_points: null,
    published_at: '2026-07-08T10:00:00+08:00',
    experts: {
      name: '張大濤',
      slug: 'zhang-datao',
      role: 'mentor',
      avatar_url: null,
    },
  })),
};

export default function JournalPdfHarnessEntry() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'blocked'>(
    isPreviewEnv() ? 'loading' : 'blocked',
  );

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    (async () => {
      await ensureJournalPdfFonts();
      if (cancelled || !rootRef.current || !probeRef.current) return;
      const htmls = await renderJournalPageHtmls(FIXTURE as any, probeRef.current);
      if (cancelled || !rootRef.current) return;
      rootRef.current.innerHTML = htmls
        .map(
          (h, i) =>
            `<div data-pdf-page="${i + 1}" data-total-pages="${htmls.length}" style="display:block;margin:0 auto 24px;box-shadow:0 0 0 1px #E4DFD6;">${h}</div>`,
        )
        .join('');
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'blocked') return null;

  return (
    <div
      style={{
        background: '#EFEBE4',
        minHeight: '100vh',
        padding: '24px 12px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        data-pdf-harness-status={status}
        style={{ textAlign: 'center', fontSize: 12, color: '#6E665D', marginBottom: 12 }}
      >
        journal-pdf-harness · {status}
      </div>
      <div ref={rootRef} data-pdf-pages-root />
      {/* Off-screen probe for measureAndSplit; unmounted from DOM view */}
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{ position: 'fixed', left: -10000, top: 0, width: 0, height: 0, overflow: 'hidden' }}
      />
    </div>
  );
}
