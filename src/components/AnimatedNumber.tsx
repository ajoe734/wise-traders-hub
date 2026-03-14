import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * AnimatedNumber — 漸近式緩和跳動效果
 * 數值變動時以 ease-out 曲線平滑過渡到新數值，
 * 同時根據台股慣例閃爍紅（漲）/ 綠（跌）。
 */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = 600,
}: {
  value: number | null;
  format: (v: number) => string;
  className?: string;
  /** 動畫持續時間 (ms)，預設 600 */
  duration?: number;
}) {
  const prevValueRef = useRef<number | null>(null);
  const displayRef = useRef<number | null>(value);
  const [displayValue, setDisplayValue] = useState<number | null>(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const rafRef = useRef<number>(0);

  // ease-out cubic
  const easeOutCubic = useCallback((t: number) => 1 - Math.pow(1 - t, 3), []);

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;

    if (prev == null || value == null) {
      displayRef.current = value;
      setDisplayValue(value);
      return;
    }

    if (prev === value) return;

    // Flash colour
    setFlash(value > prev ? 'up' : 'down');
    const flashTimer = setTimeout(() => setFlash(null), duration + 200);

    // Smooth interpolation
    const startValue = displayRef.current ?? prev;
    const delta = value - startValue;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);
      const current = startValue + delta * easedProgress;
      displayRef.current = current;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = value;
        setDisplayValue(value);
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      clearTimeout(flashTimer);
      cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, easeOutCubic]);

  if (displayValue == null) return <span className={className}>-</span>;

  return (
    <span
      className={cn(
        className,
        'transition-colors duration-300',
        flash === 'up' && 'text-red-500 dark:text-red-400',
        flash === 'down' && 'text-green-500 dark:text-green-400',
      )}
    >
      {format(displayValue)}
    </span>
  );
}
