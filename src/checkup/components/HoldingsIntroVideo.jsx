import { useState, useEffect, useRef, useCallback } from "react";
import intro16x9 from "@/assets/holdings-promo-16x9.mp4.asset.json";
import intro9x16 from "@/assets/holdings-promo-9x16.mp4.asset.json";

const STORAGE_KEY = "holdings-intro-video-seen-v2";
const SESSION_KEY = "holdings-intro-video-dismissed-session";

/**
 * /holding-checkup 介紹影片 — **一次性 modal**（demo 首屏可見性修復 v3）。
 *
 * 規則：
 *  - **只在 isDemo=true 出現**；已登入 full / line_only 一律不渲染、不掛 listener
 *  - 首次進入 /holding-checkup (demo 且未看過) 才自動彈出
 *  - 使用者按 X / 收合 → modal 關閉、本 session 不再彈（sessionStorage）
 *  - 「不再顯示」→ localStorage 永久 flag，跨 session 都不再彈
 *  - **modal 關閉時 <video> 完全 unmount**（自動停止播放），切 tab 不會重複出現
 *  - 不佔首屏高度（fixed overlay，非 inline 區塊）
 *  - **Focus 管理**：open 時 focus 進 modal（close button）；close 時還原到 open 前
 *    的 activeElement，若已 detach 則 fallback 到 `<body>`
 */
export function HoldingsIntroVideo({ isDemo = false }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const closeBtnRef = useRef(null);
  // 開啟前的 activeElement — 關閉時還原焦點。SSR 安全：初始為 null。
  const previousFocusRef = useRef(null);

  // 只在 demo mode 才掛 listener / 觸發 auto-open
  useEffect(() => {
    if (!isDemo) return;
    try {
      const seenForever = localStorage.getItem(STORAGE_KEY) === "1";
      const dismissedSession = sessionStorage.getItem(SESSION_KEY) === "1";
      if (!seenForever && !dismissedSession) setOpen(true);
    } catch { /* noop */ }
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const fn = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, [isDemo]);

  // Focus 進入 modal / 離開時還原
  useEffect(() => {
    if (!isDemo || !open) return;

    // 記住開啟前的焦點（可能是 <body> — 那就 fallback，反正不會 focus 到已 unmount 的元素）
    previousFocusRef.current =
      typeof document !== "undefined" ? document.activeElement : null;

    // 把焦點移入 modal（close 按鈕）→ 鍵盤/screen reader 進入 dialog 上下文
    // 用 rAF 確保 DOM commit + button ref 已附上
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus?.();
    });

    return () => {
      cancelAnimationFrame(raf);
      // Modal 關閉時還原焦點
      const prev = previousFocusRef.current;
      const body = typeof document !== "undefined" ? document.body : null;
      const canRestore =
        prev &&
        typeof prev.focus === "function" &&
        prev.isConnected &&
        prev !== document.body;
      if (canRestore) {
        try { prev.focus(); } catch {/* noop */}
      } else if (body && typeof body.focus === "function") {
        try { body.focus(); } catch {/* noop */}
      }
      previousFocusRef.current = null;
    };
  }, [isDemo, open]);

  const closeSession = useCallback(() => {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {/* noop */}
    setOpen(false);
  }, []);

  const dismissForever = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {/* noop */}
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {/* noop */}
    setOpen(false);
  }, []);

  // ESC 關閉（等同 closeSession：只寫 session flag，不寫永久 flag）
  useEffect(() => {
    if (!isDemo || !open) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeSession();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDemo, open, closeSession]);

  if (!isDemo) return null;
  if (!open) return null;

  const src = isMobile ? intro9x16.url : intro16x9.url;

  return (
    <div
      data-testid="holdings-intro-modal"
      role="dialog"
      aria-modal="true"
      aria-label="30 秒看懂持倉看板"
      onClick={closeSession}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(20, 18, 14, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#F5F3EF",
          border: "1px solid #D8D3C9",
          borderRadius: 14,
          padding: 14,
          maxWidth: isMobile ? 360 : 720,
          width: "100%",
          position: "relative",
          boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ position: "absolute", top: 6, right: 8, display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={dismissForever}
            aria-label="不再顯示介紹影片"
            style={{
              background: "transparent", border: "none",
              color: "#8A857C", fontSize: 12, cursor: "pointer", padding: 4,
            }}
          >不再顯示</button>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={closeSession}
            aria-label="關閉介紹影片"
            style={{
              background: "transparent", border: "none",
              color: "#2B2926", fontSize: 16, cursor: "pointer", padding: "2px 6px",
              lineHeight: 1,
            }}
          >✕</button>
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
            marginTop: 24,
          }}
        />
        <div style={{ fontSize: 11, color: "#8A857C", marginTop: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          legendflow · 30 秒看懂持倉看板
        </div>
      </div>
    </div>
  );
}

export default HoldingsIntroVideo;
