import { useEffect, useState } from "react";
import { C, alpha } from "../theme.js";

const STORAGE_KEY = "checkup-coach-seen-v1";

const STEPS = [
  {
    targetTab: "trade",
    title: "上傳成交",
    body: "把券商 App 的成交截圖丟進來，AI 自動辨識並寫入持倉，你可逐欄修正。",
  },
  {
    targetTab: "daily",
    title: "收盤分析",
    body: "每日收盤後一鍵 AI 健檢，幫你檢視整體部位的風險與機會。",
  },
  {
    targetTab: "events",
    title: "行事曆與事件",
    body: "持倉相關的法說、除權息與重大事件會自動列入，提早做準備。",
  },
];

export function CoachMarks({ onTabChange }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // 延遲一點等版面定位
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch {/* localStorage 可能被擋 */}
  }, []);

  if (!open) return null;
  const current = STEPS[step];
  const isLast = step >= STEPS.length - 1;

  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {/* noop */}
    setOpen(false);
  };

  const next = () => {
    if (isLast) { close(); return; }
    const nextStep = step + 1;
    setStep(nextStep);
    onTabChange?.(STEPS[nextStep].targetTab);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新手導覽"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "20px",
      }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: "20px 22px",
          maxWidth: 360, width: "100%",
          boxShadow: "0 -2px 24px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",fontWeight:500}}>
            STEP {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={close}
            aria-label="略過導覽"
            style={{background:"transparent",border:"none",color:C.textMute,fontSize:12,cursor:"pointer",padding:4}}
          >略過</button>
        </div>
        <div style={{fontSize:18,fontWeight:500,color:C.text,marginBottom:8,letterSpacing:"0.02em"}}>
          {current.title}
        </div>
        <div style={{fontSize:13,color:C.textSec,lineHeight:1.7,marginBottom:16}}>
          {current.body}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:16}}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex:1, height:2, borderRadius:1,
              background: i <= step ? C.text : alpha(C.textMute, '30'),
              transition: "background 200ms ease",
            }}/>
          ))}
        </div>
        <button
          onClick={next}
          style={{
            width:"100%", padding:"12px",
            background:C.text, color:C.card,
            border:"none", borderRadius:8,
            fontSize:14, fontWeight:500, cursor:"pointer",
            letterSpacing:"0.04em", fontFamily:"inherit",
          }}
        >
          {isLast ? "開始使用" : "下一步"}
        </button>
      </div>
    </div>
  );
}

export default CoachMarks;
