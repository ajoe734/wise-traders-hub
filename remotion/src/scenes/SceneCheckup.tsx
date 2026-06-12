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

        {/* 健檢結果卡 */}
        <div
          style={{
            opacity: cardOp,
            transform: `translateY(${cardY}px)`,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 18,
            padding: isPortrait ? "26px 28px" : "32px 40px",
            width: isPortrait ? "92%" : 820,
            position: "absolute",
            bottom: isPortrait ? 40 : 80,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: C.mute, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              今日健檢結果
            </div>
            <div style={{ fontSize: 14, color: C.mute }}>2026/06/12 · 收盤後</div>
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 18 }}>
            <Tag color={C.up} label="2 檔需注意" />
            <Tag color={C.orange} label="1 檔接近停利" />
            <Tag color={C.down} label="3 檔健康" />
          </div>
          <div style={{ fontSize: 18, lineHeight: 1.6, color: C.inkSoft }}>
            <span style={{ fontWeight: 600, color: C.up }}>2603 長榮</span> 已達停利區間 +8.6%，建議分批調節；
            <span style={{ fontWeight: 600, color: C.up }}>2317 鴻海</span> 跌破均線，留意 205 支撐。
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
