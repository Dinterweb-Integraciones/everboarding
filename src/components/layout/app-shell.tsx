import Link from "next/link";

import { BrandLogo } from "@/components/layout/brand-logo";
import { UserMenu } from "@/components/layout/user-menu";

type AppShellProps = {
  children: React.ReactNode;
  email: string;
  homeHref: string;
  showDashboardLink: boolean;
};

export function AppShell({
  children,
  email,
  homeHref,
  showDashboardLink,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#fcfcfc]">
      <header className="sticky top-0 z-30 border-b border-[#dfe3eb] bg-white">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <BrandLogo href={homeHref} priority />
            {showDashboardLink ? (
              <Link
                href="/dashboard"
                className="hidden text-[11px] font-bold uppercase tracking-[0.16em] text-[#516f90] transition hover:text-[#33475b] md:block"
              >
                Dashboard
              </Link>
            ) : null}
          </div>
          <UserMenu email={email} />
        </div>
      </header>
      <main className="w-full">{children}</main>
    </div>
  );
}
