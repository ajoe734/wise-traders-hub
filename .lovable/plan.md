

# 分析師頁面返回按鈕修正

## 問題

目前在 `/app/expert/:slug`（分析師詳情頁）的返回按鈕固定導向「探索」頁面 (`/app/explore`)，但用戶可能是從「戰情室」(`/app`) 點進來的，希望返回時回到戰情室。

---

## 解法

將返回按鈕改為導向「戰情室」(`/app`)，並更新按鈕文字。

---

## 修改內容

### 檔案：`src/pages/app/ExpertDetail.tsx`

#### 1. 更新返回按鈕（第 121-130 行）

把：
```tsx
<Button 
  variant="ghost" 
  size="sm" 
  onClick={() => navigate("/app/explore")}
  className="gap-2 -ml-2"
>
  <ArrowLeft className="h-4 w-4" />
  返回探索
</Button>
```

改為：
```tsx
<Button 
  variant="ghost" 
  size="sm" 
  onClick={() => navigate("/app")}
  className="gap-2 -ml-2"
>
  <ArrowLeft className="h-4 w-4" />
  返回戰情室
</Button>
```

#### 2. 更新「找不到專家」時的返回按鈕（第 64 行）

把：
```tsx
<Button variant="ghost" onClick={() => navigate("/app/explore")} className="mt-4">
  返回探索
</Button>
```

改為：
```tsx
<Button variant="ghost" onClick={() => navigate("/app")} className="mt-4">
  返回戰情室
</Button>
```

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/pages/app/ExpertDetail.tsx` | 修改 | 返回按鈕導向改為戰情室 |

