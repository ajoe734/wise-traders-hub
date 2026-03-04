

## Quick-Template Feature for Signal Reason Summary

### Overview

Add a per-analyst "reason template" system so analysts can one-click insert pre-written reason text when publishing signals, reducing publish time.

### 1. Database Schema

New table `expert_reason_templates`:

```sql
CREATE TABLE public.expert_reason_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL,
  title text NOT NULL,        -- chip label, e.g. "突破壓力位"
  content text NOT NULL,      -- full text inserted into textarea
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_reason_templates ENABLE ROW LEVEL SECURITY;

-- Analysts manage own templates
CREATE POLICY "Analysts can manage own templates"
  ON public.expert_reason_templates FOR ALL TO authenticated
  USING (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()))
  WITH CHECK (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

-- Company admins full access
CREATE POLICY "Company admins full access reason templates"
  ON public.expert_reason_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));
```

No edge functions needed -- all CRUD goes directly through the Supabase client, protected by RLS. This matches the existing pattern used for `expert_signals`, `expert_plans`, etc.

### 2. Files to Create / Modify

**New file: `src/pages/admin/ReasonTemplates.tsx`**
- Full CRUD page at `/admin/:expertSlug/reason-templates`
- List templates ordered by `sort_order`
- Inline add/edit via dialog (title + content fields)
- Delete with confirmation
- Drag-to-reorder using native HTML drag events (no extra library needed), updating `sort_order` in batch

**Modify: `src/App.tsx`**
- Import `ReasonTemplates` page
- Add route: `/admin/:expertSlug/reason-templates`

**Modify: `src/components/layouts/AdminLayout.tsx`**
- Add nav item "理由模板" with a `FileText` icon linking to `${basePath}/reason-templates`

**Modify: `src/pages/admin/Signals.tsx`**
- Fetch `expert_reason_templates` when dialog opens (ordered by `sort_order`)
- Render a row of chip buttons above the "操作理由（摘要）" textarea
- On click: set `reasonSummary` to the template's `content`

### 3. UI Behavior

#### Signal Publish Dialog (Signals.tsx)

```text
┌──────────────────────────────────┐
│ 股票代碼        股票名稱          │
│ 操作方向        參考價位          │
│                                  │
│ 快速模板：                        │
│ [突破壓力位] [回測支撐] [停利]     │
│                                  │
│ 操作理由（摘要）                   │
│ ┌──────────────────────────────┐ │
│ │ (auto-filled on click)       │ │
│ └──────────────────────────────┘ │
│ ...                              │
└──────────────────────────────────┘
```

- Chips styled as small outline buttons, scrollable if many
- Clicking a chip **replaces** the textarea content (simple and fast for real-time use)
- If no templates exist, the chip row is hidden

#### Template Management Page (`/admin/:expertSlug/reason-templates`)

```text
┌─────────────────────────────────────────┐
│ 理由模板管理              [+ 新增模板]   │
│─────────────────────────────────────────│
│ ≡  突破壓力位  │ 突破壓力位，順勢做多  [✏️][🗑] │
│ ≡  回測支撐    │ 回測支撐位，短線布局  [✏️][🗑] │
│ ≡  停利       │ 技術面轉弱，先行停利  [✏️][🗑] │
│ ≡  減碼       │ 風險控管，先減碼      [✏️][🗑] │
└─────────────────────────────────────────┘
```

- Drag handle (≡) on left for reorder
- Edit opens a dialog with title + content fields
- Delete with confirmation toast
- Reorder updates `sort_order` via batch update

### 4. Implementation Summary

| Step | What |
|------|------|
| 1 | Create `expert_reason_templates` table + RLS via migration |
| 2 | Create `ReasonTemplates.tsx` page with full CRUD + drag sort |
| 3 | Add route in `App.tsx` and nav item in `AdminLayout.tsx` |
| 4 | Add template chips to signal publish dialog in `Signals.tsx` |

