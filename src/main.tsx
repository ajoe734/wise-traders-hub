import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installEdgeFetchInterceptor } from "./checkup/lib/edgeFetchInterceptor.js";

// 啟用持倉看板 Edge Function 前端輸入驗證攔截器（缺欄位/格式錯誤時 toast + console.error）
installEdgeFetchInterceptor();

createRoot(document.getElementById("root")!).render(<App />);
