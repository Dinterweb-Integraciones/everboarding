import type { Database } from "@/types/database";

export const APP_NAME = "Everboarding";
export const PLAN_PRICE_FACTOR = 14.96;
export const UPSELL_PACK_CREDITS = 12;
export const UPSELL_PACK_PRICE = 199;
export const REDUCTION_PENALTY_RATE = 0.2;
export const RISK_INACTIVE_DAYS = 45;

export const PLAN_TIER_OPTIONS = [60, 80, 100] as const;

export const STATUS_META: Record<
  Database["public"]["Enums"]["initiative_status"],
  {
    label: string;
    accent: string;
    muted: string;
    columnClass: string;
  }
> = {
  backlog: {
    label: "En evaluacion",
    accent: "text-slate-600",
    muted: "bg-slate-100 text-slate-700",
    columnClass: "border-slate-200 bg-white/80",
  },
  planned: {
    label: "Planificado",
    accent: "text-indigo-600",
    muted: "bg-indigo-50 text-indigo-700",
    columnClass: "border-indigo-200 bg-indigo-50/60",
  },
  executing: {
    label: "En ejecucion",
    accent: "text-emerald-600",
    muted: "bg-emerald-50 text-emerald-700",
    columnClass: "border-emerald-200 bg-emerald-50/60",
  },
  completed: {
    label: "Completado",
    accent: "text-slate-800",
    muted: "bg-slate-200 text-slate-800",
    columnClass: "border-slate-300 bg-slate-100/80",
  },
};

export const ACCESS_ROLE_META: Record<
  Database["public"]["Enums"]["client_access_role"],
  { label: string; description: string }
> = {
  owner: {
    label: "Propietario",
    description: "Control total del cliente, onboarding y permisos compartidos.",
  },
  editor: {
    label: "Editor",
    description: "Puede editar el onboarding y los datos operativos del cliente.",
  },
  viewer: {
    label: "Solo lectura",
    description: "Puede ver el onboarding y los reportes, sin editar.",
  },
};

export const STAGE_META: Record<
  Database["public"]["Enums"]["project_stage"],
  { label: string; shortLabel: string; description: string; accent: string }
> = {
  sales: {
    label: "Ventas",
    shortLabel: "Prospecto",
    description: "Vista comercial para presentar alcance, oferta y roadmap inicial.",
    accent: "text-orange-600",
  },
  cs: {
    label: "CS",
    shortLabel: "CS",
    description: "Vista operativa del Customer Success Manager para ejecutar y coordinar.",
    accent: "text-teal-600",
  },
  client: {
    label: "Cliente",
    shortLabel: "Cliente",
    description: "Vista del cliente para seguimiento y validacion del onboarding.",
    accent: "text-sky-600",
  },
};

export const PROFILE_ROLE_META: Record<
  Database["public"]["Enums"]["client_profile_role"],
  { label: string; description: string }
> = {
  sales: {
    label: "Ventas",
    description: "Perfil comercial con foco en propuesta, alcance y negociacion.",
  },
  csm: {
    label: "CSM",
    description: "Perfil operativo para coordinar ejecucion y adopcion.",
  },
  client: {
    label: "Cliente",
    description: "Perfil del stakeholder o equipo del cliente.",
  },
  stakeholder: {
    label: "Stakeholder",
    description: "Colaborador adicional con visibilidad sobre el proyecto.",
  },
};
