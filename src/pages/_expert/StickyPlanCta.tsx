import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

interface StickyPlanCtaProps {
  /** 已含 preserved UTM 的完整目標路徑；null 時只捲到 #plans。 */
  to: string | null;
  label: string;
  variant?: 'advisor' | 'mentor';
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * 手機底部單一主 CTA。桌機隱藏（桌機主 CTA 在方案卡內）。
 * 高度固定 64px，頁尾以等高 spacer 讓底部內容完全可見。
 */
export function StickyPlanCta({ to, label, variant = 'mentor', onClick, disabled }: StickyPlanCtaProps) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden"
      data-testid="sticky-plan-cta"
    >
      {disabled || !to ? (
        <Button
          className="w-full"
          size="lg"
          variant={variant as any}
          onClick={() => {
            onClick?.();
            document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {label}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      ) : (
        <Button className="w-full" size="lg" variant={variant as any} asChild>
          <Link to={to} onClick={onClick}>
            {label}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      )}
    </div>
  );
}
