import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "bg-[var(--accent)] text-white shadow-sm hover:bg-[var(--accent-strong)] focus-visible:ring-[var(--accent)]",
        variant === "secondary" &&
          "border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-300",
        variant === "ghost" &&
          "text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-300",
        variant === "danger" &&
          "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500",
        className,
      )}
      {...props}
    />
  );
}
