import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

/**
 * Defers rendering of `children` until the placeholder scrolls near the viewport.
 * Used to keep the homepage's first paint cheap by skipping below-the-fold sections.
 *
 * Two modes:
 * - "io" (default): IntersectionObserver — children mount only when visible.
 *   Use for sections that wrap React.lazy() chunks you don't want to import on first paint.
 *   Trade-off: when children mount, the placeholder minHeight is removed and any
 *   delta vs the real height contributes to CLS.
 * - "content-visibility": children always mount, but the browser skips layout/paint
 *   until the element is near the viewport via `content-visibility: auto`. Combined
 *   with `contain-intrinsic-size`, the placeholder height stays stable through the
 *   swap, so CLS stays near zero. Use for big static sections (Index.tsx).
 */
export function LazyOnVisible({
  children,
  rootMargin = "400px",
  minHeight = 320,
  className,
  mode = "io",
}: {
  children: ReactNode;
  rootMargin?: string;
  minHeight?: number;
  className?: string;
  mode?: "io" | "content-visibility";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(mode === "content-visibility");

  useEffect(() => {
    if (mode === "content-visibility") return;
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mode, rootMargin, visible]);

  if (mode === "content-visibility") {
    const style: CSSProperties = {
      contentVisibility: "auto" as CSSProperties["contentVisibility"],
      containIntrinsicSize: `${minHeight}px`,
    };
    return (
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <div ref={ref} className={className} style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  );
}
