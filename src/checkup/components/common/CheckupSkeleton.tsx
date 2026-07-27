import { CSSProperties } from 'react';

/**
 * CheckupSkeleton — 持倉看板統一 loading 骨架。
 *
 * 為 Phase B (holdings-consistency-tdd.md) 建立的單一 skeleton 元件。
 * 一律使用 src/index.css 的 `@keyframes shimmer`，避免各處各自維護 keyframes。
 *
 * 遵守 prefers-reduced-motion：若使用者關閉動畫則以靜態淺色塊呈現。
 */
export type CheckupSkeletonVariant = 'page' | 'card' | 'row' | 'inline';

interface CheckupSkeletonProps {
  variant?: CheckupSkeletonVariant;
  count?: number;
  label?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

const HAIR = 'var(--cm-hair, #ECEAE5)';
const HAIR_STRONG = 'var(--cm-hair-strong, #D8D2C4)';

const lineBase: CSSProperties = {
  display: 'block',
  height: 10,
  borderRadius: 2,
  background: `linear-gradient(90deg, ${HAIR} 0%, ${HAIR_STRONG} 50%, ${HAIR} 100%)`,
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.4s ease-in-out infinite',
};

function Line({ width = '100%', height = 10 }: { width?: string | number; height?: number }) {
  return <span aria-hidden style={{ ...lineBase, width, height }} />;
}

function CardBlock() {
  return (
    <div
      style={{
        border: `1px solid ${HAIR}`,
        borderRadius: 4,
        padding: '14px 16px',
        background: 'var(--cm-paper, #f5f3ef)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 118,
      }}
    >
      <Line width="40%" height={12} />
      <Line width="80%" height={16} />
      <Line width="60%" />
    </div>
  );
}

export function CheckupSkeleton({
  variant = 'page',
  count,
  label = '載入中',
  style,
  'data-testid': testId = 'checkup-skeleton',
}: CheckupSkeletonProps) {
  const n = count ?? (variant === 'page' ? 6 : variant === 'card' ? 1 : 3);

  if (variant === 'inline') {
    return (
      <span
        data-testid={testId}
        data-variant={variant}
        role="status"
        aria-live="polite"
        aria-label={label}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}
      >
        <Line width={80} height={10} />
      </span>
    );
  }

  if (variant === 'row') {
    return (
      <div
        data-testid={testId}
        data-variant={variant}
        role="status"
        aria-live="polite"
        aria-label={label}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', ...style }}
      >
        {Array.from({ length: n }).map((_, i) => (
          <Line key={i} width={i % 2 === 0 ? '80%' : '60%'} />
        ))}
      </div>
    );
  }

  // page / card
  return (
    <div
      data-testid={testId}
      data-variant={variant}
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns:
          variant === 'page' ? 'repeat(auto-fill, minmax(240px, 1fr))' : '1fr',
        padding: '8px 0 4px',
        ...style,
      }}
    >
      {Array.from({ length: n }).map((_, i) => (
        <CardBlock key={i} />
      ))}
    </div>
  );
}

export default CheckupSkeleton;
