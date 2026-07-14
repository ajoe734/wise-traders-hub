interface Props {
  kind: 'exit' | 'review' | 'hold';
  className?: string;
}

/** 44px 動作徽章 —— 出場（橘底白字）／檢視（橘框橘字）／hold 不顯示。 */
export function ActionBadge({ kind, className }: Props) {
  if (kind === 'hold') return null;
  const label = kind === 'exit' ? '出場' : '檢視';
  return (
    <span
      className={`${kind === 'exit' ? 'cm-badge-exit' : 'cm-badge-review'} ${className || ''}`}
      aria-label={label}
    >
      {label}
    </span>
  );
}

export default ActionBadge;
