"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

type TimelineScrollbarProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  dayWidth: number;
};

// A native horizontal scrollbar is easy to miss (thin, OS-themed, sometimes
// only shown on hover) — this renders an always-visible, always-the-same
// slider under a gantt board: drag the thumb, click the track, or use the
// arrow buttons to page a month at a time. It drives the same container's
// scrollLeft the native scrollbar would have, it's just guaranteed visible.
export function TimelineScrollbar({ containerRef, dayWidth }: TimelineScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null);
  const [metrics, setMetrics] = useState({ scrollLeft: 0, scrollWidth: 1, clientWidth: 1 });

  const readMetrics = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setMetrics({ scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }, [containerRef]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    readMetrics();
    el.addEventListener("scroll", readMetrics, { passive: true });

    const resizeObserver = new ResizeObserver(readMetrics);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", readMetrics);
      resizeObserver.disconnect();
    };
  }, [containerRef, readMetrics]);

  const maxScrollLeft = Math.max(metrics.scrollWidth - metrics.clientWidth, 0);
  const thumbWidthRatio = Math.min(1, metrics.clientWidth / Math.max(metrics.scrollWidth, 1));
  const scrollRatio = maxScrollLeft > 0 ? metrics.scrollLeft / maxScrollLeft : 0;
  const thumbLeftRatio = scrollRatio * (1 - thumbWidthRatio);

  function scrollByMonths(monthCount: number) {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollLeft + monthCount * 30 * dayWidth, behavior: "smooth" });
  }

  function jumpToTrackPosition(clientX: number) {
    const el = containerRef.current;
    const track = trackRef.current;
    if (!el || !track || maxScrollLeft <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.scrollTo({ left: ratio * maxScrollLeft, behavior: "smooth" });
  }

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    jumpToTrackPosition(event.clientX);
  }

  function handleThumbPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: el.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleThumbPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const el = containerRef.current;
    const track = trackRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !el || !track) return;
    const trackWidth = track.getBoundingClientRect().width;
    if (trackWidth <= 0) return;
    // The thumb only travels the leftover track (trackWidth minus its own
    // width), so the drag ratio has to be scaled against that usable
    // distance — not the full track width — to track the cursor 1:1.
    const usableTrackWidth = Math.max(trackWidth * (1 - thumbWidthRatio), 1);
    const deltaScroll = ((event.clientX - drag.startX) / usableTrackWidth) * maxScrollLeft;
    el.scrollLeft = Math.max(0, Math.min(maxScrollLeft, drag.startScrollLeft + deltaScroll));
  }

  function handleThumbPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="flex items-center gap-2 select-none">
      <button
        type="button"
        onClick={() => scrollByMonths(-1)}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[#cbd6e2] bg-white text-[#516f90] shadow-sm transition hover:bg-[#f5f8fa]"
        aria-label="Mes anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        className="relative h-2.5 flex-1 cursor-pointer rounded-full bg-[#eef2f7]"
      >
        <div
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
          style={{
            position: "absolute",
            insetBlock: 0,
            left: `${thumbLeftRatio * 100}%`,
            width: `${Math.max(thumbWidthRatio * 100, 8)}%`,
          }}
          className="min-w-[32px] cursor-grab touch-none rounded-full bg-[#99a6b8] transition-colors hover:bg-[#7c8aa0] active:cursor-grabbing active:bg-[#7c8aa0]"
        />
      </div>
      <button
        type="button"
        onClick={() => scrollByMonths(1)}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[#cbd6e2] bg-white text-[#516f90] shadow-sm transition hover:bg-[#f5f8fa]"
        aria-label="Mes siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
