import Link from "next/link";
import { FolderTree, House } from "lucide-react";

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
  const privateLinks = [{ href: "/dashboard", label: "Inicio", icon: House }];
  const catalogLinks = [
    { href: "/cs/categorias", label: "Categorías" },
    { href: "/cs/tareas", label: "Tareas" },
    { href: "/cs/grupos", label: "Grupos" },
  ];
  const navTriggerClass =
    "inline-flex items-center gap-2 text-[#516f90] transition hover:text-[#33475b]";
  const navLabelClass =
    "inline-block text-[12px] font-bold uppercase leading-none tracking-[0.18em] [font-family:inherit]";

  return (
    <div className="min-h-screen bg-[#fcfcfc]">
      <header className="sticky top-0 z-30 border-b border-[#dfe3eb] bg-white">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <BrandLogo href={homeHref} priority />
            {showDashboardLink ? (
              <nav className="hidden items-center gap-4 md:flex">
                {privateLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={navTriggerClass}
                  >
                    <link.icon className="h-3.5 w-3.5" />
                    <span className={navLabelClass}>{link.label}</span>
                  </Link>
                ))}
                <div className="group relative">
                  <button type="button" className={navTriggerClass}>
                    <FolderTree className="h-3.5 w-3.5" />
                    <span className={navLabelClass}>Catálogos</span>
                  </button>
                  <div className="invisible absolute left-0 top-full z-40 mt-3 w-52 rounded-[14px] border border-[#dfe3eb] bg-white p-2 opacity-0 shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all group-hover:visible group-hover:opacity-100">
                    {catalogLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="block rounded-[10px] px-3 py-2 text-sm font-semibold text-[#516f90] transition hover:bg-slate-50 hover:text-[#33475b]"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </nav>
            ) : null}
          </div>
          <UserMenu email={email} />
        </div>
      </header>
      <main className="w-full">{children}</main>
    </div>
  );
}
