import { useLayoutEffect, useState } from 'react';

/**
 * 訂閱 window 寬度。寫成獨立 hook 以便下沉到「真正用到 vw 的子元件」，
 * 避免 resize tick 觸發 3,500 行 god component 全量 re-render。
 */
export function useViewportWidth(initial = 1280): number {
  const [vw, setVw] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : initial
  );
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    setVw(window.innerWidth);
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vw;
}
