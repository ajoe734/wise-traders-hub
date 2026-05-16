// useInView — 輕量 IntersectionObserver hook
// 用於延遲渲染離畫面的卡片內容（C2/C3 perf）。
// 一旦進入過視窗，就鎖定為 true（不再卸載），確保滾上滾下不抖動。
import { useEffect, useRef, useState } from 'react';

export function useInView({ rootMargin = '400px 0px', threshold = 0 } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return; // 已經出現過，不再觀察
    const el = ref.current;
    if (!el) return;
    // SSR / 老瀏覽器 fallback：直接顯示
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
          break;
        }
      }
    }, { rootMargin, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin, threshold]);

  return [ref, inView];
}
