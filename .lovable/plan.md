# 管理員測試帳號 qw2811569@gmail.com 全功能測試權限

## 現況（已查證）

- 帳號存在（user_id `b3502f0a-386b-474c-8cbd-9846044b7ee5`，2026/3/4 註冊，今天有登入）
- 已有 `company_admin` 角色 → 後台 `/company/*` 全部可用
- `is_tester = false`、`expert_slug = null`、無任何訂閱
- 因此被擋的功能：
  1. **健檢配額**：`check_checkup_quota` 等函數對 `is_tester=true` 直接放行，目前會受配額限制
  2. **草稿/未發布內容預覽**：多處 RLS 政策寫 `status='draft' AND is_tester(auth.uid())`，目前看不到
  3. **專家訊號/週記等訂閱內容**：需有效訂閱，管理員身份不自動放行（RLS 以 `has_active_subscription` 判斷）

## 處理方案

### 1. 開啟 is_tester（主要動作，一條 SQL）

```sql
UPDATE public.profiles SET is_tester = true
WHERE user_id = 'b3502f0a-386b-474c-8cbd-9846044b7ee5';
```

- 效果：健檢/收盤分析配額不再受限、可預覽草稿狀態的方案與內容
- 安全性：`is_tester` 欄位受 `protect_profile_fields()` trigger 保護，只有 company_admin 能改；變更會寫入稽核紀錄（audit trigger 已存在）
- 不影響營收/流量統計口徑以外的資料

### 2. 訂閱內容測試：用既有 View-as，不開假訂閱

- 要測「訂閱者看到的專家訊號/週記」，用後台既有的 **View-as 視角檢視**（唯讀模擬任一真實訂閱者），不替此帳號建立假訂閱
- 理由：假訂閱會污染營收、續訂率、訂閱者名單等營運數字；View-as 是唯讀且有倒數橫幅，安全且不留髒資料

### 3. 驗收

- 以 qw2811569 登入 Preview：
  - 健檢功能不再被配額擋
  - 後台 Users 頁可見自己 is_tester 標記已開
  - View-as 一位有效訂閱者，可看到訂閱內容
- 跑 `npm run check:rls-audit` 確認權限稽核仍全綠

## 不做的事

- 不新增 `analyst` 角色（此帳號不是老師，不需要發訊號）
- 不建立任何測試訂閱或付款紀錄
- 不動 RLS 政策、不發布正式網站

## 技術細節

- 異動範圍：僅 `profiles.is_tester` 一個欄位（資料庫 update，非 migration）
- 相關機制：`is_tester(uuid)` 函數（20260603 migrations 內配額放行邏輯）、`protect_profile_fields()` trigger、`admin-manage-users` Edge Function（後台 UI 也有開關可切）
- 回復方式：同樣一條 SQL 改回 `false`，或後台 Users 頁關掉開關
