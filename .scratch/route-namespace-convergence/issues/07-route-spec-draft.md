# 07 — 路由規格書草稿

Type: prototype
Status: open
Blocked by: 01, 02, 05, 06

## Question

把前面所有決策收束成一份可直接實作的規格草稿，供人反應與修正。

草稿需包含：

- 完整 old → new 路由對照表（含參數化路由與別名）。
- 每條路由的 guard 等級與失敗落地。
- canonical / sitemap / og:url 規則。
- 遷移批次切分（哪些檔案一批），對應到後續實作票。

產出物：`.scratch/route-namespace-convergence/spec.md`，並從本票連結。
