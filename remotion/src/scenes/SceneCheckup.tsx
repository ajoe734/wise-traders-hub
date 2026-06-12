import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { C } from "../theme";
import { FF_SERIF } from "../fonts";
import type { Orientation } from "../MainVideo";

const STEPS = ["讀取部位", "分析風險", "產出建議"];

export const SceneCheckup: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isPortrait = orientation === "portrait";

  const headerOp = interpolate(frame, [5, 25], [0, 1], { extrapolateRight: "clamp" });

  // 按鈕脈動 (frame 0-35)
  const pulse = Math.sin((frame / 8) * Math.PI) * 0.5 + 0.5;
  const btnHide = interpolate(frame, [40, 55], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // 進度條 frame 40 -> 100
  const progress = interpolate(frame, [45, 105], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const progressOp = interpolate(frame, [40, 55, 110, 120], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // 健檢卡片 frame 105 起滑入
  const cardSp = spring({ frame: frame - 105, fps, config: { damping: 22, stiffness: 110 } });
  const cardY = interpolate(cardSp, [0, 1], [60, 0]);
  const cardOp = interpolate(frame, [105, 125], [0, 1], { extrapolateRight: "clamp" });

  const stepIdx = Math.min(2, Math.floor((frame - 45) / 20));

  return (
    <AbsoluteFill style={{ padding: isPortrait ? "80px 60px" : "100px 140px" }}>
      <div style={{ opacity: headerOp, marginBottom: isPortrait ? 30 : 50 }}>
        <div style={{ fontSize: 14, color: C.mute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 14 }}>
          02 / 收盤 AI 健檢
        </div>
        <h2
          style={{
            fontFamily: FF_SERIF,
            fontSize: isPortrait ? 56 : 78,
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.025em",
          }}
        >
          一鍵健檢，<span style={{ color: C.orange }}>整體部位風險</span>都在掌握
        </h2>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40 }}>
        {/* 按鈕 */}
        <div
          style={{
            opacity: btnHide,
            position: "relative",
            padding: "22px 56px",
            background: C.ink,
            color: C.bg,
            borderRadius: 12,
            fontSize: 24,
            fontWeight: 500,
            letterSpacing: "0.04em",
            boxShadow: `0 0 0 ${4 + pulse * 16}px ${C.orange}${Math.round((1 - pulse) * 30 + 8).toString(16).padStart(2, "0")}`,
          }}
        >
          ▶ 開始 AI 健檢
        </div>

        {/* 進度條 */}
        <div style={{ opacity: progressOp, width: isPortrait ? "85%" : 720 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 16 }}>
            {STEPS.map((s, i) => (
              <span key={s} style={{ color: i <= stepIdx ? C.ink : C.mute, fontWeight: i === stepIdx ? 600 : 400 }}>
                {i <= stepIdx ? "● " : "○ "}{s}
              </span>
            ))}
          </div>
          <div style={{ height: 6, background: C.line, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: C.orange }} />
          </div>
        </div>

        {/* 健檢結果卡：5 檔逐一滑入，停留到結束 */}
        <div
          style={{
            opacity: cardOp,
            transform: `translateY(${cardY}px)`,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 18,
            padding: isPortrait ? "22px 24px" : "28px 36px",
            width: isPortrait ? "92%" : 860,
            position: "absolute",
            bottom: isPortrait ? 40 : 60,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <div style={{ fontSize: 14, color: C.mute, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              今日健檢結果 · 6 檔個股
            </div>
            <div style={{ fontSize: 14, color: C.mute }}>2026/06/12 · 收盤後</div>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <Tag color={C.up} label="2 檔需注意" />
            <Tag color={C.orange} label="1 檔接近停利" />
            <Tag color={C.down} label="3 檔健康" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {STOCKS.map((s, i) => {
              const rowSp = spring({ frame: frame - (130 + i * 10), fps, config: { damping: 22, stiffness: 140 } });
              return (
                <div
                  key={s.code}
                  style={{
                    opacity: rowSp,
                    transform: `translateX(${interpolate(rowSp, [0, 1], [24, 0])}px)`,
                    display: "grid",
                    gridTemplateColumns: isPortrait ? "92px 1fr 70px" : "120px 1fr 80px",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 14px",
                    background: `${s.color}0d`,
                    borderLeft: `3px solid ${s.color}`,
                    borderRadius: 8,
                    fontSize: isPortrait ? 15 : 17,
                  }}
                >
                  <div style={{ fontWeight: 600, color: s.color }}>{s.code} {s.name}</div>
                  <div style={{ color: C.inkSoft, lineHeight: 1.4 }}>{s.note}</div>
                  <div style={{ textAlign: "right", fontWeight: 600, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.pct}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const STOCKS = [
  { code: "2603", name: "長榮",   color: "#C73E2E", pct: "+8.6%", note: "達停利區間，建議分批調節" },
  { code: "2330", name: "台積電", color: "#C73E2E", pct: "+5.2%", note: "趨勢延續，續抱觀察季線" },
  { code: "2454", name: "聯發科", color: "#C73E2E", pct: "+3.1%", note: "法說後動能轉強，健康" },
  { code: "2317", name: "鴻海",   color: "#3F8F4E", pct: "−2.4%", note: "跌破均線，留意 205 支撐" },
  { code: "3008", name: "大立光", color: "#3F8F4E", pct: "−1.8%", note: "成交量縮，等待量能回補" },
];

const Tag: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div
    style={{
      padding: "8px 16px",
      borderRadius: 999,
      background: `${color}14`,
      color: color,
      fontSize: 15,
      fontWeight: 500,
    }}
  >
    {label}
  </div>
);
