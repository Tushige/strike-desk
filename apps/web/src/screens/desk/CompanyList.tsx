import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Fade only the edges that have more company cards beyond them. */
export function CompanyList({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = viewport.current;
    if (el === null) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setEdges((previous) =>
      previous.top === top && previous.bottom === bottom ? previous : { top, bottom },
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current !== null) observer.observe(viewport.current);
    if (content.current !== null) observer.observe(content.current);
    return () => {
      observer.disconnect();
    };
  }, [measure]);
  return (
    <div className="company-list-shell">
      <div
        ref={viewport}
        className="company-list-scroll"
        role="region"
        aria-label="Company cards"
        tabIndex={0}
        data-fade-top={edges.top}
        data-fade-bottom={edges.bottom}
        onScroll={measure}
      >
        <div ref={content} className="flex flex-col gap-3 p-1.5">
          {children}
        </div>
      </div>
    </div>
  );
}
