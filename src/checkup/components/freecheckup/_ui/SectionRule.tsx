import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}

/** Monocle 節標：1px ink 主線 + serif 節標 + 右側 meta（件數/日期）。 */
export function SectionRule({ title, meta, className }: Props) {
  return (
    <div className={className} style={{ borderTop: '1px solid var(--cm-ink)', padding: '14px 0 10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <h3
          className="cm-serif"
          style={{ margin: 0, fontSize: 16, letterSpacing: 0, color: 'var(--cm-ink)' }}
        >
          {title}
        </h3>
        {meta != null && (
          <span
            className="cm-label cm-num"
            style={{ color: 'var(--cm-ink-sec)', letterSpacing: '0.10em' }}
          >
            {meta}
          </span>
        )}
      </div>
    </div>
  );
}

export default SectionRule;
