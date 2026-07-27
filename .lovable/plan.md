## 持倉看板 TDD 收尾 — 已完成（2026-07-27）

Phase A（Deep-link 消費）與 Phase B（Skeleton 一致性）皆已收斂，契約回寫至 `docs/architecture/holdings-modules.md`，原 TDD 追蹤檔已刪除。

驗收結果：
- `bunx vitest run src/test/unit/checkup-route-hooks.test.tsx` 12/12 綠
- `rg "holdingsSkeletonShimmer" src` 無殘留
- `HoldingRow` 帶 `data-expanded` 供 E2E 使用
- `CheckupSkeleton` variant `page/card/row/inline` 上線

如需擴充新事件或新 loading 位，直接依 `holdings-modules.md` 的 Deep-link 契約表與 Skeleton 章節套版。
