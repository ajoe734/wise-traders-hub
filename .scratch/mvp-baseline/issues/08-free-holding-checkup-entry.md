# 08 — 免費持倉健檢入口與雲端同步

**What to build:** 訪客不需登入即可在 `/holding-checkup` 輸入持倉並看到基本健檢結果；登入後本機資料自動同步上雲且與他人隔離；免費額度用盡時出現升級引導，Demo 模式提供影片與預覽入口。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 匿名可用；登入後 localStorage 資料一次性同步至雲端且不覆蓋他人資料
- [ ] Freemium 限額與升級引導正確觸發
- [ ] Demo 模式（影片 Modal＋預覽入口）可運作
- [ ] 手機回歸清單通過：560／390／380px 三斷點 + 視覺截圖 + `bunx playwright test e2e/freecheckup-card.spec.ts`
- [ ] 所有 `fontSize ≥ 32` 皆有對應 className 與 ≤560px／≤380px media query
