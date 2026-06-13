import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { C } from "../theme";
import { FF_SERIF } from "../fonts";
import { padOf } from "../safeArea";
import type { Orientation } from "../MainVideo";

// 事件落點：[dayIndex (0-27), label, color]
const EVENTS: Array<[number, string, string]> = [
  [3, "2330 法說", "#EC662D"],
  [9, "2454 除息", "#D9342B"],
  [14, "2317 股東會", "#1F8A4C"],
  [21, "2603 法說", "#EC662D"],
];

export const SceneCalendar: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  const frame = useCurrentFrame();
  const isPortrait = orientation === "portrait";

  const headerOp = interpolate(frame, [5, 25], [0, 1], { extrapolateRight: "clamp" });

  // 28 day grid (4w x 7d)
  const cellSize = isPortrait ? 78 : 100;
  const gap = 10;
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <AbsoluteFill style={{ padding: padOf(isPortrait) }}>
      <div style={{ opacity: headerOp, marginBottom: isPortrait ? 24 : 40 }}>
        <div style={{ fontSize: 14, color: C.mute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 12 }}>
          03 / 行事曆 + 事件
        </div>
        <h2
          style={{
            fontFamily: FF_SERIF,
            fontSize: isPortrait ? 60 : 72,
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
          }}
        >
          法說、除權息，<span style={{ color: C.orange }}>提早自動提醒</span>
        </h2>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div>
          {/* weekday header */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${cellSize}px)`, gap, marginBottom: 12 }}>
            {weekdays.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 14, color: C.mute, letterSpacing: "0.1em" }}>
                {d}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(7, ${cellSize}px)`,
              gap,
            }}
          >
            {Array.from({ length: 28 }).map((_, i) => {
              const cellOp = interpolate(frame, [10 + i * 1.5, 25 + i * 1.5], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const ev = EVENTS.find(([d]) => d === i);
              const evStart = 70 + EVENTS.findIndex(([d]) => d === i) * 8;
              const evOp = ev
                ? interpolate(frame, [evStart, evStart + 14], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
                : 0;
              const evScale = ev
                ? interpolate(frame, [evStart, evStart + 18], [0.4, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
                : 1;
              return (
                <div
                  key={i}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: C.card,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 13,
                    color: C.mute,
                    opacity: cellOp,
                    position: "relative",
                    boxSizing: "border-box",
                  }}
                >
                  <div>{i + 1}</div>
                  {ev && (
                    <div
                      style={{
                        position: "absolute",
                        left: 8,
                        right: 8,
                        bottom: 8,
                        padding: "4px 6px",
                        background: ev[2],
                        color: "#fff",
                        fontSize: 11,
                        borderRadius: 4,
                        opacity: evOp,
                        transform: `scale(${evScale})`,
                        transformOrigin: "bottom left",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {ev[1]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
