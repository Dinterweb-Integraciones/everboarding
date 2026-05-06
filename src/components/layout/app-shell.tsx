import { BrandLogo } from "@/components/layout/brand-logo";
import { PrimaryNavigation } from "@/components/layout/primary-navigation";
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
          <BrandLogo href={homeHref} priority />
          <UserMenu email={email} />
        </div>
        {showDashboardLink ? (
          <div className="border-t border-[#eef2f7] px-4 py-3 sm:px-6">
            <PrimaryNavigation />
          </div>
        ) : null}
      </header>
      <main className="w-full">{children}</main>
    </div>
  );
}
