"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EMOJI_LIBRARY = [
  "💬", "📈", "⚙️", "📊", "🗂️", "🧾", "🔍", "🧩",
  "🛠️", "🤖", "🔔", "🧠", "📧", "🗓️", "💳", "🏦",
  "📞", "🧮", "📤", "📥", "🔒", "🎯", "🚀", "🧭",
  "📋", "🖇️", "👥", "🏷️", "💡", "⭐", "✅", "🔗",
  "📱", "💻", "🌐", "📝", "💰", "📦", "🔧", "🗺️",
];

const PANEL_WIDTH = 256;

type EmojiPickerProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
};

export function EmojiPicker({ value, onChange, label }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 12)),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-expanded={open}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-lg transition hover:border-[var(--accent)] hover:bg-white"
      >
        {value || "🧩"}
      </button>

      {open && position
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Cerrar selector de íconos"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[100] cursor-default"
              />
              <div
                style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
                className="fixed z-[110] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_14px_42px_rgba(15,23,42,0.14)]"
              >
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  Librería de íconos
                </p>
                <div className="grid grid-cols-8 gap-1">
                  {EMOJI_LIBRARY.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onChange(emoji);
                        setOpen(false);
                      }}
                      className="rounded-lg p-1 text-lg transition hover:bg-slate-100"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={value}
                  onChange={(event) => onChange(event.target.value.slice(0, 4))}
                  placeholder="O pega cualquier emoji"
                  className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
