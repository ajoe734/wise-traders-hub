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

  // 改為「不遮頁面」的底部 toast：原本的全螢幕黑色遮罩會擋住升級 CTA 等互動，
  // 這裡改用浮動卡片，使用者可同時看到並點擊頁面上其他元素。
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="新手導覽"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 50,
        width: "calc(100% - 32px)",
        maxWidth: 360,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: "16px 18px",
        }}
      >
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.1em",fontWeight:500}}>
            STEP {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={close}
            aria-label="略過導覽"
            style={{background:"transparent",border:"none",color:C.textMute,fontSize:12,cursor:"pointer",padding:4}}
          >略過</button>
        </div>
        <div style={{fontSize:16,fontWeight:500,color:C.text,marginBottom:6,letterSpacing:"0.02em"}}>
          {current.title}
        </div>
        <div style={{fontSize:12,color:C.textSec,lineHeight:1.7,marginBottom:12}}>
          {current.body}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12}}>
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
            width:"100%", padding:"10px",
            background:C.text, color:C.card,
            border:"none", borderRadius:8,
            fontSize:13, fontWeight:500, cursor:"pointer",
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
