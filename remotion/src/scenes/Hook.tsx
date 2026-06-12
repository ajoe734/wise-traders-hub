import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { C } from "../theme";
import { FF_SERIF } from "../fonts";
import { Caption, Wordmark } from "../components/Brand";
import type { Orientation } from "../MainVideo";

export const Hook: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isPortrait = orientation === "portrait";

  // 橘點放大進入
  const dot = spring({ frame: frame - 6, fps, config: { damping: 18, stiffness: 120 } });
  const dotScale = interpolate(dot, [0, 1], [0, 1]);

  // wordmark / 標題依序淡入
  const wmOp = interpolate(frame, [18, 32], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [30, 55], [40, 0], { extrapolateRight: "clamp" });
  const titleOp = interpolate(frame, [30, 55], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: isPortrait ? 80 : 120,
      }}
    >
      <div style={{ position: "relative", textAlign: "center" }}>
        <div
          style={{
            width: isPortrait ? 28 : 36,
            height: isPortrait ? 28 : 36,
            borderRadius: "50%",
            background: C.orange,
            margin: "0 auto",
            marginBottom: isPortrait ? 40 : 56,
            transform: `scale(${dotScale})`,
          }}
        />
        <div style={{ opacity: wmOp, marginBottom: isPortrait ? 56 : 72 }}>
          <Caption size={isPortrait ? 18 : 20}>legendflow · holding checkup</Caption>
        </div>
        <h1
          style={{
            fontFamily: FF_SERIF,
            fontSize: isPortrait ? 84 : 132,
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
            color: C.ink,
            margin: 0,
            opacity: titleOp,
            transform: `translateY(${titleY}px)`,
            maxWidth: isPortrait ? 900 : 1500,
          }}
        >
          上傳一張截圖<br />
          <span style={{ color: C.orange }}>AI</span> 幫你顧好每一檔
        </h1>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: isPortrait ? 100 : 80,
          opacity: interpolate(frame, [50, 70], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        <Wordmark size={isPortrait ? 28 : 36} />
      </div>
    </AbsoluteFill>
  );
};
