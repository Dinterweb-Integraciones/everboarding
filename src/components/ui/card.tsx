import { cn } from "@/lib/utils";

type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/70 bg-white/90 shadow-[0_14px_35px_rgba(15,23,42,0.08)] backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}
