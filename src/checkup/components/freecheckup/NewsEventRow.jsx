import React from "react";
import { C, alpha } from "../../theme.js";

/**
 * News tab event row — memoized.
 *
 * Hoisted out of FreeCheckup.jsx render body to:
 * 1. Stop component identity churn (was redeclared every render → re-mounts)
 * 2. Skip non-active rows on review-form keystroke (via React.memo + isReviewing snapshot)
 *
 * Allowed by inline-rendering constitution as a `list-item-level memo wrapper`.
 * See mem://architecture/checkup/inline-rendering-audit.
 *
 * Props contract (keep all primitives / stable refs to preserve memo):
 *   e               — event object (stable id)
 *   idx             — number
 *   tintBg          — precomputed background color string
 *   open            — boolean
 *   isReviewing     — boolean
 *   reviewForm      — object | undefined (only when isReviewing)
 *   onToggle        — (id) => void  [stable]
 *   onStartReview   — (id) => void  [stable]
 *   onCancelReview  — () => void    [stable]
 *   onChangeReview  — (patch) => void  [stable, accepts partial form]
 *   onSubmitReview  — (id) => void  [stable]
 */
function NewsEventRowImpl({
  e,
  idx: _idx,
  tintBg,
  open,
  isReviewing,
  reviewForm,
  onToggle,
  onStartReview,
  onCancelReview,
  onChangeReview,
  onSubmitReview,
}) {
  const predIcon = (p) => (p === "up" ? "↑" : p === "down" ? "↓" : "—");
  const predLabel = (p) => (p === "up" ? "看漲" : p === "down" ? "看跌" : "中性");
  const predC = (p) => (p === "up" ? C.up : p === "down" ? C.down : C.textMute);

  const isCorrect = e.correct;
  const borderC =
    e.status === "past"
      ? isCorrect === true
        ? alpha(C.olive, "99")
        : isCorrect === false
        ? alpha(C.up, "99")
        : C.border
      : alpha(predC(e.pred), "55");

  return (
    <div
      onClick={() => onToggle(e.id)}
      style={{
        background: tintBg,
        border: `1px solid ${C.border}`,
        borderLeft: `2px solid ${borderC}`,
        borderRadius: 10,
        marginBottom: 6,
        cursor: "pointer",
        overflow: "hidden",
        transition: "all 0.15s",
      }}
    >
      {/* ── 縮列行 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <div
          style={{
            minWidth: 26,
            textAlign: "center",
            fontSize: 13,
            fontWeight: 400,
            color: predC(e.pred),
            opacity: 0.7,
          }}
        >
          {predIcon(e.pred)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: C.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {e.title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.textMute }}>{e.date}</span>
            {(Array.isArray(e.stocks)
              ? e.stocks
              : typeof e.stocks === "string"
              ? e.stocks.split(/[,、\s]+/).filter(Boolean)
              : []
            )
              .slice(0, 2)
              .map((s, si) => {
                const label = typeof s === "string" ? s.split(" ")[0] : s.code || s.name || "";
                return (
                  <span
                    key={si}
                    style={{
                      fontSize: 12,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: C.subtle,
                      color: C.textSec,
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            {e.stocks.length > 2 && (
              <span style={{ fontSize: 12, color: C.textMute }}>+{e.stocks.length - 2}</span>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 3,
            flexShrink: 0,
          }}
        >
          {e.status === "past" && isCorrect !== null && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: isCorrect ? C.olive : C.amber,
              }}
            >
              {isCorrect ? "✓ 正確" : "⚠ 有誤"}
            </span>
          )}
          {e.status === "verifying" && (
            <span style={{ fontSize: 11, color: C.amber, fontWeight: 400 }}>待驗證</span>
          )}
          {e.status === "pending" && (
            <span style={{ fontSize: 12, color: C.textMute, fontWeight: 500 }}>待觀察</span>
          )}
          <span style={{ fontSize: 12, color: C.textMute }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* ── 展開內容 ── */}
      {open && (
        <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${C.borderSub}`, paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {e.stocks.map((s, si) => {
              const label = typeof s === "string" ? s : `${s.code || ""} ${s.name || ""}`.trim();
              return (
                <span
                  key={si}
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 3,
                    background: C.blueBg,
                    color: C.blue,
                    fontWeight: 500,
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>

          <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.8, marginBottom: 8 }}>{e.detail}</div>

          <div
            style={{
              background: C.subtle,
              borderRadius: 7,
              padding: "9px 11px",
              marginBottom: e.actualNote ? 8 : 0,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: predC(e.pred),
                fontWeight: 400,
                marginBottom: 3,
                letterSpacing: "0.06em",
              }}
            >
              {predIcon(e.pred)} 預測{predLabel(e.pred)} — 邏輯
            </div>
            <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7 }}>{e.predReason}</div>
          </div>

          {e.actualNote && (
            <div
              style={{
                background: isCorrect ? alpha(C.olive, "08") : alpha(C.up, "08"),
                border: `1px solid ${isCorrect ? alpha(C.olive, "44") : alpha(C.up, "44")}`,
                borderRadius: 7,
                padding: "9px 11px",
                marginTop: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: isCorrect ? C.olive : C.up,
                  fontWeight: 400,
                  marginBottom: 3,
                  letterSpacing: "0.06em",
                }}
              >
                {predIcon(e.actual)} 實際{predLabel(e.actual)} — {isCorrect ? "預測正確" : "預測有誤"}
              </div>
              <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7 }}>{e.actualNote}</div>
            </div>
          )}

          {e.lessons && (
            <div
              style={{
                background: C.blueBg,
                border: `1px solid ${alpha(C.blue, "33")}`,
                borderRadius: 7,
                padding: "9px 11px",
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 12, color: C.textSec, fontWeight: 400, marginBottom: 3 }}>
                策略覆盤教訓
              </div>
              <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7 }}>{e.lessons}</div>
            </div>
          )}

          {(e.status === "pending" || e.status === "verifying") && (
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                onStartReview(e.id);
              }}
              style={{
                marginTop: 10,
                width: "100%",
                padding: "9px",
                background: alpha(C.olive, "22"),
                border: `1px solid ${alpha(C.olive, "55")}`,
                borderRadius: 8,
                color: C.olive,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              標記結果 · 撰寫復盤
            </button>
          )}

          {isReviewing && reviewForm && (
            <div
              onClick={(ev) => ev.stopPropagation()}
              style={{
                marginTop: 10,
                background: C.subtle,
                borderRadius: 8,
                padding: 12,
                border: `1px solid ${alpha(C.blue, "44")}`,
              }}
            >
              <div style={{ fontSize: 12, color: C.textSec, fontWeight: 400, marginBottom: 10 }}>
                撰寫完整復盤
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: C.textMute, marginBottom: 4 }}>實際走勢</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["up", "down", "neutral"].map((v) => (
                    <button
                      key={v}
                      onClick={() => onChangeReview({ actual: v })}
                      style={{
                        flex: 1,
                        padding: "6px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                        background:
                          reviewForm.actual === v
                            ? v === "up"
                              ? C.upBg
                              : v === "down"
                              ? C.downBg
                              : C.subtle
                            : "transparent",
                        color:
                          reviewForm.actual === v
                            ? v === "up"
                              ? C.up
                              : v === "down"
                              ? C.down
                              : C.textSec
                            : C.textMute,
                        border: `1px solid ${
                          reviewForm.actual === v
                            ? v === "up"
                              ? alpha(C.up, "55")
                              : v === "down"
                              ? alpha(C.down, "55")
                              : C.border
                            : C.border
                        }`,
                      }}
                    >
                      {v === "up" ? "↑ 漲" : v === "down" ? "↓ 跌" : "— 中性"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: C.textMute, marginBottom: 4 }}>
                  發生了什麼？股價怎麼走？
                </div>
                <textarea
                  value={reviewForm.actualNote}
                  onChange={(ev) => onChangeReview({ actualNote: ev.target.value })}
                  placeholder="描述事件結果和股價反應..."
                  style={{
                    width: "100%",
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 7,
                    padding: 8,
                    color: C.text,
                    fontSize: 13,
                    resize: "none",
                    minHeight: 60,
                    outline: "none",
                    fontFamily: "inherit",
                    lineHeight: 1.7,
                  }}
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: C.textMute, marginBottom: 4 }}>
                  策略覆盤：問題出在哪？學到什麼？下次怎麼改？
                </div>
                <textarea
                  value={reviewForm.lessons}
                  onChange={(ev) => onChangeReview({ lessons: ev.target.value })}
                  placeholder="進場理由回顧、策略偏差、改進方向..."
                  style={{
                    width: "100%",
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 7,
                    padding: 8,
                    color: C.text,
                    fontSize: 13,
                    resize: "none",
                    minHeight: 60,
                    outline: "none",
                    fontFamily: "inherit",
                    lineHeight: 1.7,
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={onCancelReview}
                  style={{
                    flex: 1,
                    padding: "9px",
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    borderRadius: 7,
                    color: C.textMute,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  onClick={() => onSubmitReview(e.id)}
                  disabled={!reviewForm.actualNote.trim()}
                  style={{
                    flex: 2,
                    padding: "9px",
                    borderRadius: 7,
                    border: "none",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    background: reviewForm.actualNote.trim() ? alpha(C.olive, "cc") : C.subtle,
                    color: reviewForm.actualNote.trim() ? "#fff" : C.textMute,
                  }}
                >
                  確認送出復盤
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const NewsEventRow = React.memo(NewsEventRowImpl);
export default NewsEventRow;
