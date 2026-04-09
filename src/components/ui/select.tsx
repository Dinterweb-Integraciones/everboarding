import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-10 py-2.5 text-sm leading-5 text-slate-900 shadow-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_20%,white)]",
        className,
      )}
      {...props}
    />
  );
}
