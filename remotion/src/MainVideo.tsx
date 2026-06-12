import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";
import { C } from "./theme";
import { FF_SANS } from "./fonts";
import { Hook } from "./scenes/Hook";
import { SceneOcr } from "./scenes/SceneOcr";
import { SceneCheckup } from "./scenes/SceneCheckup";
import { SceneCalendar } from "./scenes/SceneCalendar";
import { Outro } from "./scenes/Outro";

export type Orientation = "landscape" | "portrait";

// Scene budget (frames @30fps):
//   Hook        0   -> 75   (2.5s)
//   OCR        75   -> 210  (4.5s)  with 12f cross-fade
//   Checkup   210   -> 420  (7.0s)  +2s 讓觀眾看清健檢結果
//   Calendar  420   -> 555  (4.5s)
//   Outro     555   -> 660  (3.5s)

const FADE = 12;

function Crossfade({
  from,
  duration,
  children,
}: {
  from: number;
  duration: number;
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const local = frame - from;
  const opacity = interpolate(
    local,
    [0, FADE, duration - FADE, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill style={{ opacity }}>
      <Sequence from={from} durationInFrames={duration}>
        {children}
      </Sequence>
    </AbsoluteFill>
  );
}

export const MainVideo: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  return (
    <AbsoluteFill
      style={{
        background: C.bg,
        fontFamily: FF_SANS,
        color: C.ink,
      }}
    >
      <Crossfade from={0} duration={75}>
        <Hook orientation={orientation} />
      </Crossfade>
      <Crossfade from={75} duration={135}>
        <SceneOcr orientation={orientation} />
      </Crossfade>
      <Crossfade from={210} duration={210}>
        <SceneCheckup orientation={orientation} />
      </Crossfade>
      <Crossfade from={420} duration={135}>
        <SceneCalendar orientation={orientation} />
      </Crossfade>
      <Crossfade from={555} duration={105}>
        <Outro orientation={orientation} />
      </Crossfade>
    </AbsoluteFill>
  );
};
