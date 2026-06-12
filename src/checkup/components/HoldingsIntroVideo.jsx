import { useState, useEffect } from "react";
import intro16x9 from "@/assets/holdings-promo-16x9.mp4.asset.json";
import intro9x16 from "@/assets/holdings-promo-9x16.mp4.asset.json";

const STORAGE_KEY = "holdings-intro-video-seen-v1";

/**
 * 首次進入 /holding-checkup 時，於頁面頂端顯示一張 20 秒介紹影片卡片。
 * 關閉後 localStorage 寫旗標，往後不再自動顯示。
 * Mobile 用直式 9:16，desktop 用橫式 16:9。
 */
export function HoldingsIntroVideo() {
  const [show, setShow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {/* noop */}
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const fn = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);

  if (!show) return null;

  const src = isMobile ? intro9x16.url : intro16x9.url;
  const close = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {/* noop */}
    setShow(false);
  };

  return (
    <div
      style={{
        margin: "16px auto",
        maxWidth: isMobile ? 360 : 720,
        background: "#F5F3EF",
        border: "1px solid #D8D3C9",
        borderRadius: 14,
        padding: 14,
        position: "relative",
      }}
    >
      <button
        onClick={close}
        aria-label="關閉介紹影片"
        style={{
          position: "absolute", top: 8, right: 10,
          background: "transparent", border: "none",
          color: "#8A857C", fontSize: 13, cursor: "pointer", padding: 6,
        }}
      >不再顯示 ✕</button>
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
