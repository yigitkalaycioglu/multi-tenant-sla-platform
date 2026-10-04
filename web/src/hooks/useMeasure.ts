import { useEffect, useRef, useState } from 'react';

/**
 * Kapsayicinin genisligini olcer.
 * SVG grafikler gercek piksel genisliginde cizilir; boylece metinler
 * `preserveAspectRatio` esnemesinden etkilenmez ve etiketler carpismaz.
 */
export function useMeasure<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (!next) return;
      setWidth((prev) => (Math.abs(next - prev) > 0.5 ? next : prev));
    });

    observer.observe(element);
    setWidth(element.getBoundingClientRect().width || fallback);

    return () => observer.disconnect();
  }, [fallback]);

  return [ref, width];
}
