

## Upgrade to Signal Templates (完整訊號模板系統)

### Overview

Evolve the existing `expert_reason_templates` (single-field text) into `expert_signal_templates` (multi-field signal templates) that auto-fill action, reason_summary, reason_detail, and risk_notes in one click. Keep the old reason templates table for backward compatibility but replace the UI with the new system.

### 1. Database Migration

New table `expert_signal_templates`:

```sql
CREATE TABLE public.expert_signal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL,
  title text NOT NULL,           -- chip label
  action text NOT NULL,          -- buy/sell/add/trim/exit
  reason text NOT NULL DEFAULT '',          -- → reason_summary
  risk_note text NOT NULL DEFAULT '',       -- → risk_notes
  strategy_note text NOT NULL DEFAULT '',   -- → reason_detail
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_signal_templates ENABLE ROW LEVEL SECURITY;

-- Same RLS pattern as expert_reason_templates
CREATE POLICY "Analysts can manage own signal templates"
  ON public.expert_signal_templates FOR ALL TO authenticated
  USING (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()))
  WITH CHECK (expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid()));

CREATE POLICY "Company admins full access signal templates"
  ON public.expert_signal_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'company_admin'))
  WITH CHECK (has_role(auth.uid(), 'company_admin'));
```

No edge functions needed — direct client CRUD via RLS.

### 2. Files to Create / Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/admin/SignalTemplates.tsx` | **Create** | Full CRUD + drag-reorder page for signal templates (title, action, reason, risk_note, strategy_note) |
| `src/pages/admin/Signals.tsx` | **Modify** | Replace reason template chips with signal template chips; apply multi-field autofill logic |
| `src/App.tsx` | **Modify** | Add route `/admin/:expertSlug/signal-templates` |
| `src/components/layouts/AdminLayout.tsx` | **Modify** | Replace "理由模板" nav item with "訊號模板" pointing to new route |

The old `ReasonTemplates.tsx` page and `expert_reason_templates` table remain untouched (no breaking change), but the nav link will point to the new page instead.

### 3. Autofill Logic (Signals.tsx)

When a signal template chip is clicked:

```typescript
const applyTemplate = (tpl: SignalTemplate) => {
  // Only fill empty fields — never overwrite existing content
  if (!action) setAction(tpl.action);
  if (!reasonSummary) setReasonSummary(tpl.reason);
  if (!riskNotes) setRiskNotes(tpl.risk_note);
  if (!reasonDetail) setReasonDetail(tpl.strategy_note);
};
```

This preserves any manually entered data while filling blanks.

### 4. UI Behavior

#### Signal Publish Dialog

```text
┌──────────────────────────────────────┐
│ 股票代碼        股票名稱              │
│                                      │
│ 訊號模板：                            │
│ [突破壓力位] [回測支撐] [停利] [減碼]  │  ← scrollable
│                                      │
│ 操作方向 (auto-filled)  參考價位      │
│ 操作理由 (auto-filled)               │
│ 詳細分析 (auto-filled)               │
│ 風險提示 (auto-filled)               │
└──────────────────────────────────────┘
```

- Template chips render **above** the action selector (moved up from old position)
- Chips show action badge color to hint direction (e.g., green for buy, red for sell)
- If >6 templates, row becomes horizontally scrollable

#### Template Management Page (`/admin/:expertSlug/signal-templates`)

```text
┌──────────────────────────────────────────────────────────┐
│ 訊號模板管理                              [+ 新增模板]   │
│──────────────────────────────────────────────────────────│
│ ≡  突破壓力位  │ 買進 │ 突破壓力位，順勢做多  │ [✏️][🗑] │
│ ≡  回測支撐    │ 買進 │ 回測支撐位，短線布局  │ [✏️][🗑] │
│ ≡  停利       │ 賣出 │ 技術面轉弱，先行停利  │ [✏️][🗑] │
│ ≡  減碼       │ 減碼 │ 風險控管，先減碼      │ [✏️][🗑] │
└──────────────────────────────────────────────────────────┘
```

Create/edit dialog fields: title, action (dropdown), reason, risk_note, strategy_note.

### 5. Implementation Order

| Step | Task |
|------|------|
| 1 | Create `expert_signal_templates` table + RLS via migration |
| 2 | Create `SignalTemplates.tsx` management page with CRUD + drag sort |
| 3 | Update routing (`App.tsx`) and nav (`AdminLayout.tsx`) |
| 4 | Update `Signals.tsx`: fetch signal templates, render chips, implement multi-field autofill |

