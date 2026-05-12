import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installEdgeFetchInterceptor } from "./checkup/lib/edgeFetchInterceptor.js";
import { DedupSettingsButton } from "./checkup/components/DedupSettingsButton";

// 啟用持倉看板 Edge Function 前端輸入驗證攔截器（缺欄位/格式錯誤時 toast + console.error）
installEdgeFetchInterceptor();

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", () => {
    try {
      window.localStorage.removeItem("lf-app-cache-v1");
      window.sessionStorage.clear();
    } catch {
      // ignore storage access failures
    }

    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <DedupSettingsButton />
  </>
);
