import React from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';

const RESEARCH_TAB_PROP_SCHEMA = {
  isDemo: 'boolean',
  C: 'object',
  alpha: 'function',
  card: 'object',
  lbl: 'object',
  holdings: 'array',
  navigate: 'function',
  startLineLogin: { type: 'function', optional: true },
  setTab: 'function',
};

// §6.5：demo 訪客提示（原 DEMO_TAB_NOTICE_COPY.research 內化，唯一使用者只有 ResearchTab）
const RESEARCH_DEMO_NOTICE = {
  title: '這是 DEMO 深度研究',
  body: '預覽個股研究與策略大腦評估的輸出範例。登入後可對任一持股啟動 3 輪迭代 AI 研究，或對整體組合執行策略大腦進化。',
};

function ResearchTabImpl({
  isDemo, C, alpha, card, lbl,
  holdings, navigate, startLineLogin, setTab,
}) {
  const notice = RESEARCH_DEMO_NOTICE;
  const sample = holdings?.[0];

  const Section = ({ title, sub, children }) => (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ ...lbl, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 10, color: C.textMute, marginBottom: 8 }}>{sub}</div>}
      {children}
    </div>
  );

  const Btn = ({ onClick, children, primary }) => (
    <button onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
      border: `1px solid ${primary ? C.text : C.border}`,
      background: primary ? C.text : 'transparent',
      color: primary ? C.bg : C.textSec, cursor: 'pointer',
    }}>{children}</button>
  );

  const lockedClick = () => {
    if (!isDemo) return;
    if (startLineLogin) startLineLogin();
    else navigate('/auth/login?redirect=/holding-checkup');
  };

  return (
    <div>
      {isDemo && notice && (
        <div style={{
          ...card, marginBottom: 12,
          borderLeft: `3px solid ${alpha(C.amber, '60')}`,
          background: alpha(C.amber, '08'),
        }}>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 500, marginBottom: 4 }}>
            {notice.title}
          </div>
          <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.6 }}>
            {notice.body}
          </div>
        </div>
      )}

      <Section
        title="個股研究（deep-research）"
        sub="選一檔持股 → AI 結合 dossier + 策略大腦 + 市場數據，產出 3 輪迭代的深度報告。"
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(holdings || []).slice(0, 6).map(h => (
            <button key={h.code} onClick={lockedClick} style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 11,
              border: `1px solid ${C.border}`, background: C.card, color: C.textSec,
              cursor: 'pointer',
            }}>{h.code} {h.name}</button>
          ))}
          {(!holdings || holdings.length === 0) && (
            <div style={{ fontSize: 11, color: C.textMute }}>（先上傳成交建立持倉，即可指定個股研究）</div>
          )}
        </div>
        {sample && (
          <div style={{
            padding: 10, borderRadius: 6, background: alpha(C.text, '04'),
            fontSize: 11, color: C.textSec, lineHeight: 1.7,
          }}>
            <div style={{ fontWeight: 500, color: C.text, marginBottom: 4 }}>
              範例輸出 — {sample.code} {sample.name}
            </div>
            <div>• 基本面：營收/毛利/EPS 趨勢、產業地位、護城河</div>
            <div>• 籌碼面：法人連續買賣超、融資券、大戶持股變化</div>
            <div>• 技術面：均線結構、量價背離、關鍵支撐壓力</div>
            <div>• 風險：產業循環、單一客戶集中度、地緣事件</div>
            <div>• AI 結論：建議動作 + 止盈止損價位 + 加碼條件</div>
          </div>
        )}
      </Section>

      <Section
        title="策略大腦進化（system-review）"
        sub="對整個投資組合做系統性檢視，AI 會更新你的策略大腦規則（停損紀律、加碼條件、產業配置）。"
      >
        <div style={{
          padding: 10, borderRadius: 6, background: alpha(C.text, '04'),
          fontSize: 11, color: C.textSec, lineHeight: 1.7, marginBottom: 10,
        }}>
          <div style={{ fontWeight: 500, color: C.text, marginBottom: 4 }}>範例輸出</div>
          <div>• 組合風險：產業集中度、Beta、最大回撤模擬</div>
          <div>• 策略診斷：哪些規則本期生效、哪些失準</div>
          <div>• 規則更新：新增/修正 N 條策略大腦條目</div>
          <div>• 行動清單：本週應檢視的 N 檔持股</div>
        </div>
        <Btn onClick={lockedClick}>啟動策略大腦評估</Btn>
      </Section>

      <div style={{
        ...card, textAlign: 'center', padding: '20px 16px',
        background: alpha(C.text, '03'),
      }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 500, marginBottom: 6 }}>
          {isDemo ? '登入後即可實際執行 AI 深度研究' : '深度研究會消耗 1 次 AI 配額'}
        </div>
        <div style={{ fontSize: 11, color: C.textMute, marginBottom: 12 }}>
          {isDemo
            ? 'LINE 註冊禮提供 1 次免費完整體驗（建議用於收盤分析）'
            : '建議優先用於關鍵持股或週末整體檢視'}
        </div>
        {isDemo && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {startLineLogin && <Btn onClick={startLineLogin} primary>LINE 登入解鎖</Btn>}
            <Btn onClick={() => navigate('/auth/login?redirect=/holding-checkup')}>Email 登入</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResearchTab(props) {
  if (process.env.NODE_ENV !== 'production') {
    validateProps('ResearchTab', props, RESEARCH_TAB_PROP_SCHEMA);
  }
  return <ResearchTabImpl {...props} />;
}
