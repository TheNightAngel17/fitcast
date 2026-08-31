import { useState, useLayoutEffect, type RefObject } from 'react';

/**
 * Track the pixel width of an element. Returns 0 until the first measurement,
 * so callers should skip rendering charts while the width is still 0 rather
 * than laying out against a bogus size.
 */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = (): void => setWidth(el.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
