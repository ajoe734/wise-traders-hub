import { useState, useEffect } from "react";
import intro16x9 from "@/assets/holdings-promo-16x9.mp4.asset.json";
import intro9x16 from "@/assets/holdings-promo-9x16.mp4.asset.json";

const STORAGE_KEY = "holdings-intro-video-seen-v2";

/**
 * /holding-checkup 介紹影片入口。
 *
 * 修訂版（demo 首屏可見性修復）：
 *  - 預設「折疊」成 36px 高的迷你入口列，避免擠掉首屏看板核心資料。
 *  - 折疊狀態 **完全不渲染 <video>**（no preload / autoplay / src），DOM 內 `video` selector 必須回 0。
 *  - 點主按鈕才 setExpanded(true) → 條件渲染影片並 autoplay。
 *  - 點「不再顯示」→ localStorage `holdings-intro-video-seen-v2` 寫入 '1'，整塊隱藏。
 *  - 已有 flag 的回訪使用者，入口列也不渲染（維持原本「看過即隱藏」契約）。
 */
export function HoldingsIntroVideo() {
  const [hidden, setHidden] = useState(true); // 預設 true，等 effect 判斷
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      setHidden(seen === "1");
    } catch {
      setHidden(false);
    }
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const fn = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {/* noop */}
    setHidden(true);
  };

  const open = () => setExpanded(true);
  const collapse = () => setExpanded(false);

  // ── 折疊狀態：36px 迷你入口，絕對不渲染 <video> ──
  if (!expanded) {
    return (
      <div
        data-testid="holdings-intro-collapsed"
        style={{
          margin: "8px auto",
          maxWidth: 720,
          background: "#F5F3EF",
          border: "1px solid #D8D3C9",
          borderRadius: 8,
          padding: "0 12px",
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={open}
          style={{
            background: "transparent",
            border: "none",
            color: "#2B2926",
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: "0.04em",
            cursor: "pointer",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden="true">▶</span>
          30 秒看懂持倉看板
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="不再顯示介紹影片"
          style={{
            background: "transparent",
            border: "none",
            color: "#8A857C",
            fontSize: 11,
            cursor: "pointer",
            padding: "4px 6px",
          }}
        >
          不再顯示 ✕
        </button>
      </div>
    );
  }

  // ── 展開狀態：實際渲染 <video> ──
  const src = isMobile ? intro9x16.url : intro16x9.url;
  return (
    <div
      data-testid="holdings-intro-expanded"
      style={{
        margin: "12px auto",
        maxWidth: isMobile ? 360 : 720,
        background: "#F5F3EF",
        border: "1px solid #D8D3C9",
        borderRadius: 14,
        padding: 14,
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 6, right: 8, display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={collapse}
          aria-label="收合介紹影片"
          style={{
            background: "transparent", border: "none",
            color: "#8A857C", fontSize: 12, cursor: "pointer", padding: 4,
          }}
        >收合</button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="不再顯示介紹影片"
          style={{
            background: "transparent", border: "none",
            color: "#8A857C", fontSize: 12, cursor: "pointer", padding: 4,
          }}
        >不再顯示 ✕</button>
      </div>
      <video
        key={src}
        src={src}
        autoPlay
        muted
        playsInline
        loop
        controls
        style={{
          width: "100%",
          aspectRatio: isMobile ? "9 / 16" : "16 / 9",
          borderRadius: 8,
          background: "#000",
          display: "block",
        }}
      />
      <div style={{ fontSize: 11, color: "#8A857C", marginTop: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        legendflow · 30 秒看懂持倉看板
      </div>
    </div>
  );
}

export default HoldingsIntroVideo;
