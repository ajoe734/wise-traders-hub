import { useEffect, useRef, useState } from "react";
import { C, alpha } from "../theme.js";
import { useCheckupMode } from "../contexts/CheckupModeContext.jsx";

const STORAGE_KEY = "checkup-coach-seen-v1";
const SCROLL_THRESHOLD = 200;

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

/**
 * CoachMarks 修訂版（demo 首屏可見性修復）：
 *  - 非 demo：mount 即彈（行為不變）。
 *  - demo：首屏不顯示。等 isReady 為 true 後才掛延後監聽，避免「先彈再縮」閃現。
 *  - demo 觸發條件：scroll > 200px 或使用者切 tab（onTabChange 觸發）。
 *  - 觸發後立刻移除 scroll listener，避免重複彈出。
 *  - cleanup 確保 unmount 一定移除 listener。
 */
export function CoachMarks({ onTabChange }) {
  const { isDemo, isReady } = useCheckupMode();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const triggeredRef = useRef(false);

  useEffect(() => {
    // 等 mode 判斷完成才決策，避免閃現
    if (!isReady) return;

    let seen = false;
    try { seen = localStorage.getItem(STORAGE_KEY) === "1"; } catch {/* noop */}
    if (seen) return;
    if (triggeredRef.current) return;

    // 非 demo：維持原行為（mount 即彈，延遲 600ms 等版面定位）
    if (!isDemo) {
      const t = setTimeout(() => {
        if (triggeredRef.current) return;
        triggeredRef.current = true;
        setOpen(true);
      }, 600);
      return () => clearTimeout(t);
    }

    // demo：延後到 scroll>200 或 tab 切換
    const trigger = () => {
      if (triggeredRef.current) return;
      triggeredRef.current = true;
      setOpen(true);
      window.removeEventListener("scroll", onScroll);
    };
    const onScroll = () => {
      if (window.scrollY > SCROLL_THRESHOLD) trigger();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // 包裝 onTabChange：使用者第一次切 tab 也算觸發
    // 因為 onTabChange 是 prop callback，無法直接「監聽」，改用 effect 監聽 tab 變更不適用，
    // 改在外部用 ref 暴露：透過全域事件 'checkup:tab-change'。FreeCheckup 在 tab 點擊後 dispatch。
    const onTabEvt = () => trigger();
    window.addEventListener("checkup:tab-change", onTabEvt);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("checkup:tab-change", onTabEvt);
    };
  }, [isDemo, isReady]);

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
      aria-modal="false"
      aria-label="新手導覽"
      data-testid="coachmarks-dialog"
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
