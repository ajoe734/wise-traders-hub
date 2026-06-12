import { delayRender, continueRender } from "remotion";
import { loadFont as loadSerif } from "@remotion/google-fonts/SourceSerif4";
import { loadFont as loadSans } from "@remotion/google-fonts/NotoSansTC";

const serif = loadSerif("normal", { weights: ["400", "600"], subsets: ["latin"] });
const sans = loadSans("normal", { weights: ["400", "500", "700"] });

// Serif 主要顯示拉丁字 + legendflow logo；中文字 fallback 到 NotoSansTC。
export const FF_SANS = `${sans.fontFamily}, "PingFang TC", "Microsoft JhengHei", sans-serif`;
export const FF_SERIF = `${serif.fontFamily}, ${FF_SANS}`;

// 在 render 開始時 block 直到字型載入完成，避免中文變豆腐。
const handle = delayRender("loading-fonts");
Promise.all([serif.waitUntilDone(), sans.waitUntilDone()])
  .then(() => continueRender(handle))
  .catch((err) => {
    console.error("font load failed", err);
    continueRender(handle);
  });
