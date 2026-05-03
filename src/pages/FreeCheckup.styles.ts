/**
 * FreeCheckup external CSS strings.
 *
 * 純樣式搬家檔。**請勿改動 CSS 內容**，只是把 inline `<style>{...}</style>` 內的字串搬出來，
 * 讓 FreeCheckup.jsx 容易閱讀。Hero 與 .wb-card 的 RWD media-query 全部依原樣保留。
 *
 * - buildFreeCheckupGlobalCss(C) — 對應原 FreeCheckup.jsx 內第一段全域樣式（依賴主題 C）
 * - FREE_CHECKUP_HOLDINGS_CSS    — 對應原第二段（持倉看板 RWD，無主題依賴）
 */

type CheckupTheme = { textMute: string; [key: string]: unknown };

export function buildFreeCheckupGlobalCss(C: CheckupTheme): string {
  return `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        html{-webkit-text-size-adjust:100%}
        body{-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
        textarea::placeholder,input::placeholder{color:${C.textMute}}
        input,textarea,button{font-family:inherit;-webkit-appearance:none}
        @keyframes progress{0%{width:5%}50%{width:70%}100%{width:95%}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @media(max-width:480px){
          body{font-size:14px}
        }
        /* Hero RWD：inline fontSize:88 在窄螢幕會壓爆右側，必須用 className 覆寫 */
        @media(max-width:560px){
          .wb-hero-grid{
            grid-template-columns: 1fr !important;
            align-items: flex-start !important;
            gap: 14px !important;
          }
          .wb-hero-market{
            align-items: flex-start !important;
          }
          .wb-hero-pnl-num{
            font-size: 56px !important;
            letter-spacing: -0.03em !important;
          }
          .wb-hero-pnl-pct{
            font-size: 18px !important;
          }
          .wb-hero-kpi{
            grid-template-columns: repeat(2, minmax(0,1fr)) !important;
            gap: 14px 18px !important;
          }
          .wb-card-pnl-num{
            font-size: 36px !important;
            letter-spacing: -0.03em !important;
          }
          .wb-card-pnl-pct{
            font-size: 14px !important;
          }
        }
        @media(max-width:380px){
          .wb-hero-pnl-num{ font-size: 44px !important; }
          .wb-card-pnl-num{ font-size: 30px !important; }
        }
      `;
}

export const FREE_CHECKUP_HOLDINGS_CSS = `
            /* Desktop 預設：3 欄。改用 class 而非 inline style，讓下方 media query 能在行動端生效 */
            .holdings-card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            /* 清單檢視：強制單欄並讓 feature 卡片佔滿一列 */
            .holdings-card-grid--list { grid-template-columns: 1fr !important; }
            .holdings-card-grid--list .wb-span-feature,
            .holdings-card-grid--list .wb-card-feature { grid-column: 1 / -1 !important; }
            .holdings-card-grid--list .wb-card { min-height: 0 !important; }
            /* 卡片 span 工具類：以 CSS 控制，避免 inline style 在 RWD 切換時 race */
            .wb-span-1 { grid-column: span 1; }
            .wb-span-feature { grid-column: span 2; }
            .wb-span-full { grid-column: 1 / -1; }
            @media (max-width: 1279px) {
              .holdings-workbench { grid-template-columns: minmax(0, 1fr) minmax(0, 320px) !important; }
              .holdings-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
            }
            @media (max-width: 1023px) {
              .holdings-workbench { grid-template-columns: 1fr !important; }
              .holdings-detail-panel { display: none !important; }
              .holdings-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
            }
            /* 卡片內元素 baseline 對齊強化（所有尺寸通用） */
            .wb-card .wb-roi {
              font-feature-settings: "tnum" 1;
              vertical-align: baseline;
              white-space: nowrap;
              max-width: 100%;
              overflow: hidden;
              text-overflow: clip;
            }
            .wb-card .wb-roi > * { white-space: nowrap; }
            .wb-card .wb-bottom { align-items: baseline !important; min-width: 0; }
            .wb-card .wb-bottom > span { min-width: 0; overflow: hidden; }
            .wb-card .wb-bottom-val {
              display: inline-block;
              vertical-align: baseline;
              white-space: nowrap;
              max-width: 100%;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            @media (max-width: 768px) {
              .wb-card-feature { padding: 20px 18px 16px !important; }
              .wb-card { padding: 18px 16px 14px !important; }
              .wb-card .wb-bottom { gap: 10px !important; }
              .wb-card .wb-tags { row-gap: 6px !important; }
            }
            @media (max-width: 640px) {
              .holdings-card-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
              .wb-card-feature, .wb-span-feature { grid-column: span 1 !important; }
              .wb-card { min-height: 0 !important; }
              .wb-card .wb-spark { width: 52px !important; }
              .wb-card .wb-bottom { gap: 8px !important; }
              .wb-card .wb-bottom-val { font-size: clamp(10px, 2.6vw, 12px) !important; }
            }
            /* 持倉空狀態引導 — 手機優化 */
            @media (max-width: 560px) {
              .holdings-empty-guide { padding: 32px 16px !important; gap: 20px !important; }
              .holdings-empty-steps { grid-template-columns: 1fr !important; }
            }
            @media (max-width: 380px) {
              .holdings-empty-guide { padding: 24px 12px !important; }
            }
            @media (max-width: 380px) {
              .wb-card .wb-spark { display: none !important; }
              .wb-card .wb-bottom .wb-bottom-val { letter-spacing: 0 !important; }
              .wb-card .wb-bottom-val { font-size: clamp(9.5px, 2.4vw, 11px) !important; }
            }
            /* 極窄寬度安全溢出策略：縮放 ROI 數字避免擠壓換行 */
            @media (max-width: 340px) {
              .wb-card .wb-roi { font-size: clamp(28px, 11vw, 36px) !important; }
              .wb-card-feature .wb-roi { font-size: clamp(32px, 13vw, 44px) !important; }
              /* TODAY/VALUE 雙區塊在極窄螢幕的安全溢出策略 */
              .wb-card .wb-bottom {
                grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr) !important;
                column-gap: 6px !important;
                row-gap: 1px !important;
                max-width: 100% !important;
                overflow: hidden !important;
              }
              .wb-card .wb-bottom > span {
                min-width: 0 !important;
                max-width: 100% !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
              }
              .wb-card .wb-bottom-lbl,
              .wb-card .wb-bottom > span:not(.wb-bottom-val) {
                font-size: clamp(8.5px, 2.6vw, 10px) !important;
                letter-spacing: 0 !important;
              }
              .wb-card .wb-bottom-val {
                font-size: clamp(9px, 3vw, 11px) !important;
                letter-spacing: -0.2px !important;
                font-variant-numeric: tabular-nums !important;
              }
            }
            /* 超極窄保險（≤320px iPhone SE 1st） */
            @media (max-width: 320px) {
              .wb-card .wb-bottom { column-gap: 4px !important; }
              .wb-card .wb-bottom-val { font-size: clamp(8.5px, 2.8vw, 10.5px) !important; }
            }
          `;
