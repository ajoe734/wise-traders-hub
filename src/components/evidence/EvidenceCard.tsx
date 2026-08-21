import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EvidenceCardProps {
  title: string;
  /** 次要說明；缺值不渲染。 */
  description?: string | null;
  /** 右上角狀態文字（例如「訂閱後可見」）；缺值不渲染。 */
  meta?: string | null;
  children?: ReactNode;
  className?: string;
}

/**
 * 米白「證據卡」— 深色敘事 shell 中的證據模組。
 * root 自帶 `evidence-surface`，token 只在此作用域內生效。
 */
export function EvidenceCard({ title, description, meta, children, className }: EvidenceCardProps) {
  return (
    <div className={cn('evidence-surface rounded-[10px] p-4 md:p-5', className)}>
      <div className="ev-card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="ev-title">{title}</h3>
          {meta ? <span className="ev-mute shrink-0">{meta}</span> : null}
        </div>
        {description ? <p className="ev-body mt-2">{description}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>
  );
}
