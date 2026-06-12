import { AbsoluteFill, useCurrentFrame, interpolate, Sequence } from "remotion";
import { C } from "../theme";
import { FF_SERIF } from "../fonts";
import type { Orientation } from "../MainVideo";

const ROWS = [
  { code: "2330", name: "台積電", qty: "2", price: "1,085" },
  { code: "2454", name: "聯發科", qty: "1", price: "1,420" },
  { code: "2317", name: "鴻海", qty: "5", price: "208.5" },
  { code: "2603", name: "長榮", qty: "3", price: "215.0" },
];

const Phone: React.FC<{ frame: number; scale?: number }> = ({ frame, scale = 1 }) => {
  // 截圖滑入
  const slideIn = interpolate(frame, [0, 20], [80, 0], { extrapolateRight: "clamp" });
  const slideOp = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  // 掃描線從 20f 跑到 70f
  const scanY = interpolate(frame, [20, 70], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 360 * scale,
        height: 720 * scale,
        background: C.ink,
        borderRadius: 44 * scale,
        padding: 12 * scale,
        boxShadow: `0 30px 60px -20px rgba(0,0,0,0.15)`,
        opacity: slideOp,
        transform: `translateY(${slideIn}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#FAF8F4",
          borderRadius: 32 * scale,
          overflow: "hidden",
          position: "relative",
          padding: `${24 * scale}px ${20 * scale}px`,
          fontSize: 16 * scale,
        }}
      >
        <div style={{ fontSize: 13 * scale, color: C.mute, marginBottom: 6 * scale }}>
          券商 · 成交明細
        </div>
        <div style={{ fontSize: 20 * scale, fontWeight: 600, marginBottom: 18 * scale }}>
          今日成交 4 筆
        </div>
        {ROWS.map((r, i) => (
          <div
            key={r.code}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: `${10 * scale}px 0`,
              borderBottom: `1px solid ${C.line}`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{r.code} {r.name}</div>
              <div style={{ fontSize: 13 * scale, color: C.mute, marginTop: 2 }}>買進</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.up, fontWeight: 600 }}>${r.price}</div>
              <div style={{ fontSize: 13 * scale, color: C.mute, marginTop: 2 }}>{r.qty} 張</div>
            </div>
          </div>
        ))}
        {/* 掃描線 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${scanY}%`,
            height: 4 * scale,
            background: `linear-gradient(180deg, transparent, ${C.orange})`,
            opacity: scanY > 0 && scanY < 100 ? 0.85 : 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: `${scanY}%`,
            background: `${C.orange}10`,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
};

const Table: React.FC<{ frame: number; scale?: number }> = ({ frame, scale = 1 }) => {
  // 表格框淡入
  const op = interpolate(frame, [25, 45], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        opacity: op,
        background: C.card,
        borderRadius: 18 * scale,
        padding: `${28 * scale}px ${32 * scale}px`,
        border: `1px solid ${C.line}`,
        minWidth: 480 * scale,
      }}
    >
      <div
        style={{
          fontSize: 14 * scale,
          color: C.mute,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          marginBottom: 18 * scale,
        }}
      >
        portfolio · 持倉看板
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 0.6fr 1fr 1fr",
          gap: `${10 * scale}px 0`,
          fontSize: 18 * scale,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <div style={{ fontSize: 13 * scale, color: C.mute }}>標的</div>
        <div style={{ fontSize: 13 * scale, color: C.mute, textAlign: "right" }}>張數</div>
        <div style={{ fontSize: 13 * scale, color: C.mute, textAlign: "right" }}>成本</div>
        <div style={{ fontSize: 13 * scale, color: C.mute, textAlign: "right" }}>損益</div>
        {ROWS.map((r, i) => {
          // 每列從 frame 50 開始，每隔 8f 出現一列
          const start = 50 + i * 10;
          const rowOp = interpolate(frame, [start, start + 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const rowX = interpolate(frame, [start, start + 12], [-20, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const pnl = ["+5.2%", "+2.8%", "-1.4%", "+8.6%"][i];
          const pnlColor = pnl.startsWith("+") ? C.up : C.down;
          return (
            <React.Fragment key={r.code}>
              <div style={{ opacity: rowOp, transform: `translateX(${rowX}px)`, paddingTop: 8 * scale, borderTop: i ? `1px solid ${C.line}` : "none" }}>
                <div style={{ fontWeight: 500 }}>{r.code}</div>
                <div style={{ fontSize: 13 * scale, color: C.mute }}>{r.name}</div>
              </div>
              <div style={{ opacity: rowOp, textAlign: "right", paddingTop: 8 * scale, borderTop: i ? `1px solid ${C.line}` : "none" }}>{r.qty}</div>
              <div style={{ opacity: rowOp, textAlign: "right", paddingTop: 8 * scale, borderTop: i ? `1px solid ${C.line}` : "none" }}>${r.price}</div>
              <div style={{ opacity: rowOp, textAlign: "right", color: pnlColor, fontWeight: 600, paddingTop: 8 * scale, borderTop: i ? `1px solid ${C.line}` : "none" }}>{pnl}</div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// Arrow ribbon 在中間
const Arrow: React.FC<{ frame: number; isPortrait: boolean }> = ({ frame, isPortrait }) => {
  const op = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isPortrait ? "row" : "column",
        alignItems: "center",
        gap: 12,
        opacity: op,
        color: C.orange,
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: "0.2em", color: C.mute, textTransform: "uppercase" }}>
        AI
      </div>
      <div style={{ width: isPortrait ? 80 : 4, height: isPortrait ? 4 : 80, background: C.orange, opacity: 0.6 }} />
      <div style={{ fontSize: 28, color: C.orange }}>{isPortrait ? "↓" : "→"}</div>
    </div>
  );
};

// note: 我們在 component 內使用 React.Fragment
import React from "react";

export const SceneOcr: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  const frame = useCurrentFrame();
  const isPortrait = orientation === "portrait";

  const headerOp = interpolate(frame, [10, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ padding: isPortrait ? "80px 60px" : "100px 140px" }}>
      <div
        style={{
          opacity: headerOp,
          marginBottom: isPortrait ? 30 : 50,
        }}
      >
        <div style={{ fontSize: 14, color: C.mute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 14 }}>
          01 / AI 截圖辨識
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
          丟一張截圖，<span style={{ color: C.orange }}>部位自動建立</span>
        </h2>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: isPortrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: isPortrait ? 24 : 60,
        }}
      >
        <Phone frame={frame} scale={isPortrait ? 0.75 : 0.85} />
        <Arrow frame={frame} isPortrait={isPortrait} />
        <Table frame={frame} scale={isPortrait ? 0.75 : 1} />
      </div>
    </AbsoluteFill>
  );
};
