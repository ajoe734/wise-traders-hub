// 社群投放安全區（FB / IG / Reels / Stories）
// portrait: 9:16 — IG Reels/Stories 上方帳號列+進度條 ~240px、下方 caption/互動列/留言框 ~380px
// landscape: 16:9 — FB feed 上下互動列各 ~120px
export const SAFE = {
  portrait: { top: 240, bottom: 380, x: 60 },
  landscape: { top: 120, bottom: 120, x: 140 },
};

export const padOf = (isPortrait: boolean) => {
  const s = isPortrait ? SAFE.portrait : SAFE.landscape;
  return `${s.top}px ${s.x}px ${s.bottom}px`;
};
