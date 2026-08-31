"use client";

import { CheckCircle2, Circle, Minus, Plus, X } from "lucide-react";

import { RichTextDisplay } from "@/components/ui/rich-text";
import {
  CLIENT_USE_CASE_STATUS_COLORS,
  CLIENT_USE_CASE_STATUS_LABELS,
  type ClientUseCaseDisplayStatus,
} from "@/lib/client-use-case-status";
import type { CreditCatalogGroup, CreditCatalogUseCaseCategory } from "@/lib/onboarding";
import { type GraphEdge, type RelationKind, relationConfig } from "@/lib/use-case-graph";
import { cn } from "@/lib/utils";

type UseCaseDetailPanelProps = {
  group: CreditCatalogGroup;
  groupsById: Map<string, CreditCatalogGroup>;
  categoriesById: Map<string, CreditCatalogUseCaseCategory>;
  edges: GraphEdge[];
  completedGroupIds: Set<string>;
  status: ClientUseCaseDisplayStatus;
  isInMap: boolean;
  isSaving: boolean;
  onToggleMap: () => void;
  onClose: () => void;
};

export function UseCaseDetailPanel({
  group,
  groupsById,
  categoriesById,
  edges,
  completedGroupIds,
  status,
  isInMap,
  isSaving,
  onToggleMap,
  onClose,
}: UseCaseDetailPanelProps) {
  const statusColors = CLIENT_USE_CASE_STATUS_COLORS[status];
  const relatedEdges = edges.filter((edge) => edge.sourceId === group.id || edge.targetId === group.id);

  return (
    <section className="rounded-[20px] bg-white p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color-mix(in_oklab,var(--accent)_12%,white)] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#0f766e]">
              {group.use_case_code?.trim() || "Sin código"}
            </span>
            {group.use_case_category_id ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {categoriesById.get(group.use_case_category_id)?.name ?? "Categoría no disponible"}
              </span>
            ) : null}
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black"
              style={{ backgroundColor: statusColors.fill, color: statusColors.text }}
            >
              {status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              {CLIENT_USE_CASE_STATUS_LABELS[status]}
            </span>
          </div>
          <h3 id="use-case-detail-title" className="mt-3 text-xl font-black text-slate-950">
            {group.name}
          </h3>
          {group.description ? (
            <RichTextDisplay value={group.description} className="mt-2 max-w-3xl text-slate-600" />
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Cerrar detalle"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isSaving}
          onClick={onToggleMap}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition disabled:cursor-wait disabled:opacity-60",
            isInMap
              ? "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
              : "border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90",
          )}
        >
          {isInMap ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {isSaving ? "Guardando..." : isInMap ? "Quitar del mapa" : "Agregar al mapa"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {(Object.keys(relationConfig) as RelationKind[]).map((kind) => {
          const related = relatedEdges
            .filter((edge) => edge.kind === kind)
            .map((edge) => groupsById.get(edge.sourceId === group.id ? edge.targetId : edge.sourceId))
            .filter((item): item is CreditCatalogGroup => Boolean(item));
          return (
            <div key={kind} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: relationConfig[kind].color }} />
                {relationConfig[kind].label}
              </div>
              <div className="mt-3 space-y-2">
                {related.length ? (
                  related.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      {completedGroupIds.has(item.id) ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                      )}
                      <span className="shrink-0 text-xs font-black text-slate-400">{item.use_case_code || "—"}</span>
                      <span className="truncate">{item.name}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Sin conexiones</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
