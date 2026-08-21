import { EvidenceCard } from '@/components/evidence/EvidenceCard';

interface FitCardProps {
  riskPreference?: string | null;
  operationCycle?: string | null;
  styleTags?: string[] | null;
}

/**
 * 「適合／不適合」— 只由既有 metadata 生成，缺值不渲染該行；
 * 三者皆缺則整張卡不渲染（不補假標籤）。
 */
export function FitCard({ riskPreference, operationCycle, styleTags }: FitCardProps) {
  const tags = (styleTags || []).filter((t) => typeof t === 'string' && t.trim());
  const rows: Array<{ label: string; value: string }> = [];
  if (operationCycle) rows.push({ label: '操作週期', value: operationCycle });
  if (riskPreference) rows.push({ label: '風險偏好', value: riskPreference });
  if (tags.length > 0) rows.push({ label: '風格', value: tags.join('、') });

  if (rows.length === 0) return null;

  return (
    <EvidenceCard
      title="這套節奏適合誰"
      description="以下為這位老師登錄的操作條件。與你自己的節奏差距過大時，內容的參考價值會下降。"
    >
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-3">
            <dt className="ev-mute shrink-0" style={{ minWidth: 64 }}>{r.label}</dt>
            <dd className="ev-body">{r.value}</dd>
          </div>
        ))}
      </dl>
    </EvidenceCard>
  );
}
