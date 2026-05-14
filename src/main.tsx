import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { installEdgeFetchInterceptor } from "./checkup/lib/edgeFetchInterceptor.js";
import { DedupSettingsButton } from "./checkup/components/DedupSettingsButton";
import { installVersionCheck } from "./lib/versionCheck";

// 啟用持倉看板 Edge Function 前端輸入驗證攔截器（缺欄位/格式錯誤時 toast + console.error）
installEdgeFetchInterceptor();

// 偵測前端 chunk 版本與最新已部署版本不一致時，自動清快取並重新載入
installVersionCheck();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
    <DedupSettingsButton />
  </HelmetProvider>
);
