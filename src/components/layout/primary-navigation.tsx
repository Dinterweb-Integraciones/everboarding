"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, House, LayoutGrid, MessageSquareText } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlatformRole } from "@/lib/platform-access";

const catalogLinks = [
  { href: "/cs/categorias", label: "Categorias" },
  { href: "/cs/categorias-grupos", label: "Categorias de casos de uso" },
  { href: "/cs/tareas", label: "Tareas" },
  { href: "/cs/grupos", label: "Casos de Uso" },
  { href: "/cs/cupones", label: "Cupones" },
  { href: "/cs/ventas", label: "Ventas" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getNavItemClass(active: boolean) {
  return cn(
    "inline-flex h-10 items-center gap-2 rounded-full px-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2",
    active
      ? "bg-[color-mix(in_oklab,var(--accent)_16%,white)] text-[#0f766e] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_24%,white)]"
      : "text-[#516f90] hover:bg-[#f5f8fb] hover:text-[#33475b]",
  );
}

const navLabelClass =
  "font-sans text-[11px] font-bold uppercase leading-none tracking-[0.18em]";

type PrimaryNavigationProps = {
  platformRole: PlatformRole | null;
};

export function PrimaryNavigation({ platformRole }: PrimaryNavigationProps) {
  const pathname = usePathname();
  const canSeeCatalogs = platformRole === "admin" || platformRole === "superadmin";
  const canManageUsers = platformRole === "superadmin";
  const canSeeSales = platformRole === "superadmin";
  const catalogLinksToRender = canSeeCatalogs
    ? canManageUsers
      ? [...catalogLinks, { href: "/cs/usuarios", label: "Usuarios" }]
      : catalogLinks
    : [];
  const mobileLinks = [
    { href: "/dashboard", label: "Inicio", icon: House },
    ...(platformRole === "admin" || platformRole === "superadmin"
      ? [
          { href: "/cs/prompts", label: "Prompts", icon: MessageSquareText },
          { href: "/cs/categorias", label: "Categorias", icon: LayoutGrid },
          { href: "/cs/categorias-grupos", label: "Cat. casos de uso", icon: LayoutGrid },
          { href: "/cs/tareas", label: "Tareas", icon: LayoutGrid },
          { href: "/cs/grupos", label: "Casos de Uso", icon: LayoutGrid },
          { href: "/cs/cupones", label: "Cupones", icon: LayoutGrid },
          { href: "/cs/ventas", label: "Ventas", icon: LayoutGrid },
        ]
      : []),
    ...(canManageUsers ? [{ href: "/cs/usuarios", label: "Usuarios", icon: LayoutGrid }] : []),
    ...(canSeeSales
      ? [
          { href: "/sales/dinterweb", label: "Sales Dinterweb", icon: LayoutGrid },
          { href: "/sales/proposals/new", label: "Sales Hubspot", icon: LayoutGrid },
        ]
      : []),
  ];
  const catalogActive = catalogLinksToRender.some((link) => isActive(pathname, link.href));
  const salesLinks = [
    { href: "/sales/dinterweb", label: "Sales Dinterweb" },
    { href: "/sales/proposals/new", label: "Sales Hubspot" },
  ];
  const salesActive = salesLinks.some((link) => isActive(pathname, link.href));

  return (
    <>
      <nav className="hidden items-center gap-2 md:flex" aria-label="Navegacion principal">
        <Link href="/dashboard" className={getNavItemClass(isActive(pathname, "/dashboard"))}>
          <House className="h-4 w-4 shrink-0" />
          <span className={navLabelClass}>Inicio</span>
        </Link>

        {canSeeCatalogs ? (
          <Link href="/cs/prompts" className={getNavItemClass(isActive(pathname, "/cs/prompts"))}>
            <MessageSquareText className="h-4 w-4 shrink-0" />
            <span className={navLabelClass}>Prompts</span>
          </Link>
        ) : null}

        {canSeeCatalogs ? (
          <div className="group relative">
            <button
              type="button"
              className={cn(getNavItemClass(catalogActive), "appearance-none border-0 bg-transparent")}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className={navLabelClass}>Catalogos</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>

            <div className="invisible absolute left-0 top-full z-40 mt-2 w-56 translate-y-1 rounded-[16px] border border-[#dfe3eb] bg-white p-2 opacity-0 shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
              {catalogLinksToRender.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "block rounded-[12px] px-3 py-2.5 text-sm font-semibold transition",
                    isActive(pathname, link.href)
                      ? "bg-[color-mix(in_oklab,var(--accent)_12%,white)] text-[#0f766e]"
                      : "text-[#516f90] hover:bg-slate-50 hover:text-[#33475b]",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {canSeeSales ? (
          <div className="group relative">
            <button
              type="button"
              className={cn(getNavItemClass(salesActive), "appearance-none border-0 bg-transparent")}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className={navLabelClass}>Sales</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>

            <div className="invisible absolute left-0 top-full z-40 mt-2 w-56 translate-y-1 rounded-[16px] border border-[#dfe3eb] bg-white p-2 opacity-0 shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
              {salesLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "block rounded-[12px] px-3 py-2.5 text-sm font-semibold transition",
                    isActive(pathname, link.href)
                      ? "bg-[color-mix(in_oklab,var(--accent)_12%,white)] text-[#0f766e]"
                      : "text-[#516f90] hover:bg-slate-50 hover:text-[#33475b]",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      <nav
        className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 md:hidden"
        aria-label="Navegacion principal"
      >
        {mobileLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className={getNavItemClass(isActive(pathname, link.href))}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className={navLabelClass}>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
