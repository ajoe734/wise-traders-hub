import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { C } from "../theme";
import { FF_SERIF } from "../fonts";
import { Wordmark } from "../components/Brand";
import { padOf } from "../safeArea";
import type { Orientation } from "../MainVideo";

export const Outro: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isPortrait = orientation === "portrait";

  const wmSp = spring({ frame, fps, config: { damping: 20, stiffness: 100 } });
  const wmY = interpolate(wmSp, [0, 1], [30, 0]);

  const taglineOp = interpolate(frame, [18, 38], [0, 1], { extrapolateRight: "clamp" });
  const ctaOp = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: "clamp" });
  const urlOp = interpolate(frame, [55, 75], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        padding: padOf(isPortrait),
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div style={{ transform: `translateY(${wmY}px)`, marginBottom: isPortrait ? 60 : 80 }}>
        <Wordmark size={isPortrait ? 64 : 88} />
      </div>
      <h2
        style={{
          opacity: taglineOp,
          fontFamily: FF_SERIF,
          fontSize: isPortrait ? 56 : 78,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          margin: 0,
          marginBottom: isPortrait ? 50 : 70,
          lineHeight: 1.2,
          maxWidth: isPortrait ? 900 : 1400,
        }}
      >
        把你的持倉，<span style={{ color: C.orange }}>交給 AI 顧</span>
      </h2>
      <div
        style={{
          opacity: ctaOp,
          padding: isPortrait ? "20px 48px" : "24px 64px",
          background: C.ink,
          color: C.bg,
          borderRadius: 14,
          fontSize: isPortrait ? 22 : 28,
          fontWeight: 500,
          letterSpacing: "0.05em",
          marginBottom: isPortrait ? 32 : 44,
        }}
      >
        立即免費試用
      </div>
      <div
        style={{
          opacity: urlOp,
          fontSize: isPortrait ? 20 : 24,
          color: C.mute,
          letterSpacing: "0.08em",
        }}
      >
        legendflow.tw / holding-checkup
      </div>
    </AbsoluteFill>
  );
};
