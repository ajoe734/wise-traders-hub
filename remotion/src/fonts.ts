import { loadFont as loadSerif } from "@remotion/google-fonts/SourceSerif4";
import { loadFont as loadSans } from "@remotion/google-fonts/NotoSansTC";

const serif = loadSerif("normal", { weights: ["400", "600"], subsets: ["latin"] });
const sans = loadSans("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });

export const FF_SERIF = serif.fontFamily;
export const FF_SANS = `${sans.fontFamily}, "PingFang TC", "Microsoft JhengHei", sans-serif`;
