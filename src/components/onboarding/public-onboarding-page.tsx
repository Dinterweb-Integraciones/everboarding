"use client";

import { CalendarDays, CreditCard, Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_META, STAGE_META } from "@/lib/constants";
import {
  calculateMetrics,
  formatDateRange,
  getEstimatedStatus,
  resolveStageFromPublicAudience,
  suggestPlanPrice,
  type InitiativeRecord,
  type InitiativeStatus,
  type PublicOnboardingAudience,
  type PublicOnboardingSnapshot,
} from "@/lib/onboarding";
import { formatCurrency, formatUserError } from "@/lib/utils";

type PublicOnboardingPageProps = {
  audience: PublicOnboardingAudience;
  publicSlug: string;
  initialData: PublicOnboardingSnapshot;
};

const boardStatuses: InitiativeStatus[] = ["backlog", "planned", "executing", "completed"];

function getStatusDot(status: InitiativeStatus) {
  if (status === "executing") return "bg-emerald-500";
  if (status === "planned") return "bg-indigo-500";
  if (status === "completed") return "bg-slate-700";
  return "bg-slate-300";
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function getDaysUntil(date: string | null) {
  if (!date) return null;

  return Math.max(
    0,
    Math.ceil(
      (new Date(`${date}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

export function PublicOnboardingPage({
  audience,
  publicSlug,
  initialData,
}: PublicOnboardingPageProps) {
  const [initiatives, setInitiatives] = useState(initialData.initiatives);
  const [requestDraft, setRequestDraft] = useState({ title: "", description: "" });
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stage = resolveStageFromPublicAudience(audience);
  const stageMeta = STAGE_META[stage];
  const metrics = useMemo(
    () => calculateMetrics(initialData.config, initiatives),
    [initialData.config, initiatives],
  );

  const groupedInitiatives = useMemo(() => {
    return boardStatuses.reduce(
      (accumulator, status) => {
        accumulator[status] = initiatives
          .filter((initiative) => initiative.status === status)
          .sort((left, right) => left.sort_order - right.sort_order);
        return accumulator;
      },
      {} as Record<InitiativeStatus, InitiativeRecord[]>,
    );
  }, [initiatives]);

  const cycleDaysRemaining = useMemo(() => getDaysUntil(metrics.cutoffDate), [metrics.cutoffDate]);
  const paymentAmount = Number(
    initialData.config.custom_plan_price ??
      suggestPlanPrice(initialData.config.custom_plan_credits ?? initialData.config.base_capacity),
  );
  const progressParts = useMemo(() => {
    const total = Math.max(metrics.total, 1);

    return {
      consumed: (metrics.consumed / total) * 100,
      reserved: (metrics.reserved / total) * 100,
      lost: (metrics.lost / total) * 100,
      available: (Math.max(metrics.available, 0) / total) * 100,
    };
  }, [metrics.available, metrics.consumed, metrics.lost, metrics.reserved, metrics.total]);

  const paymentHref = initialData.paymentEmail
    ? `mailto:${initialData.paymentEmail}?subject=${encodeURIComponent(
        `Pago onboarding ${initialData.client.name}`,
      )}&body=${encodeURIComponent(
        `Hola, quiero avanzar con el onboarding de ${initialData.client.name} y proceder con el pago de ${formatCurrency(paymentAmount)}.`,
      )}`
    : null;

  async function submitPublicRequest() {
    setFeedback(null);

    if (audience !== "client") {
      return;
    }

    if (!requestDraft.title.trim()) {
      setFeedback({
        tone: "error",
        message: "Escribe un titulo para el caso de uso que quieres proponer.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/public-onboarding/${audience}/${publicSlug}/initiatives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: requestDraft.title.trim(),
          description: requestDraft.description.trim(),
        }),
      });

      const payload = (await response.json()) as
        | (InitiativeRecord & { message?: string })
        | { message?: string };

      if (!response.ok) {
        throw new Error(
          ("message" in payload && payload.message) ||
            "No fue posible registrar tu solicitud.",
        );
      }

      const nextInitiative = payload as InitiativeRecord;
      setInitiatives((current) =>
        [...current, nextInitiative].sort((left, right) => left.sort_order - right.sort_order),
      );
      setRequestDraft({ title: "", description: "" });
      setFeedback({
        tone: "success",
        message: "Tu solicitud quedo registrada en En evaluacion.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(
          caughtError,
          "No fue posible registrar tu solicitud en este momento.",
        ),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f8fa] text-[#33475b]">
      <header className="border-b border-[#dfe3eb] bg-white">
        <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <BrandLogo href="/" priority />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
              Vista publica
            </span>
            <span className="rounded-[3px] border border-[#cbd6e2] bg-[#f5f8fa] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
              {audience === "prospect" ? "Prospecto" : "Cliente"}
            </span>
          </div>

          <Button
            onClick={() => {
              if (paymentHref) {
                window.location.href = paymentHref;
              }
            }}
            disabled={!paymentHref}
            className="rounded-[10px] px-5"
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Pagar {formatCurrency(paymentAmount)}
          </Button>
        </div>
      </header>

      <main className="space-y-6 px-6 py-6">
        <section className="overflow-hidden rounded-[24px] border border-[#dfe3eb] bg-white">
          <div className="border-b border-[#dfe3eb] px-6 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[#33475b]">
                    {initialData.client.name}
                  </h1>
                  <div className="flex items-center gap-2 text-[11px] text-[#516f90]">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>{formatLongDate(initialData.config.start_date)}</span>
                  </div>
                  <Badge className="bg-[#f5f8fa] text-[#516f90]">
                    {cycleDaysRemaining ?? 0} d restantes del ciclo
                  </Badge>
                  <Badge className="bg-[#e6fffb] text-[#00a88f]">Vista {stageMeta.shortLabel}</Badge>
                </div>
                <p className="mt-4 max-w-4xl text-sm text-[#516f90]">
                  {initialData.client.description || stageMeta.description}
                </p>
              </div>

              <div className="rounded-[16px] border border-[#dfe3eb] bg-[#f8fbfd] px-4 py-3 text-sm text-[#516f90]">
                {audience === "client"
                  ? "Puedes proponer nuevas iniciativas solo en En evaluacion."
                  : "Vista publica de solo lectura para presentar alcance y roadmap."}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-6 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8aa0b4]">
              <div>
                Disponibles <span className="ml-1 text-[28px] normal-case text-[#00bda5]">{metrics.available} créditos</span>
              </div>
              <div>
                Comprometidos <span className="ml-1 text-[28px] normal-case text-[#5c6ac4]">{metrics.reserved} créditos</span>
              </div>
              <div>
                Completados <span className="ml-1 text-[28px] normal-case text-[#33475b]">{metrics.consumed} créditos</span>
              </div>
              <div>
                Deducidos <span className="ml-1 text-[28px] normal-case text-[#94a3b8]">{metrics.lost} créditos</span>
              </div>
            </div>

            <div className="mt-5 h-[4px] w-full overflow-hidden rounded-full bg-[#dfe3eb]">
              <div className="flex h-full w-full">
                <div style={{ width: `${progressParts.available}%` }} className="bg-[#00bda5]" />
                <div style={{ width: `${progressParts.reserved}%` }} className="bg-[#5c6ac4]" />
                <div style={{ width: `${progressParts.consumed}%` }} className="bg-[#33475b]" />
                <div style={{ width: `${progressParts.lost}%` }} className="bg-[#94a3b8]" />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-[#dfe3eb] bg-[#f0f4f8] p-4">
          <div className="grid gap-4 xl:grid-cols-4">
            {boardStatuses.map((status) => {
              const items = groupedInitiatives[status];

              return (
                <div key={status} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot(status)}`} />
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#516f90]">
                        {STATUS_META[status].label}
                      </p>
                    </div>
                    <span className="rounded-[3px] bg-white px-2 py-1 text-[10px] font-bold text-[#516f90]">
                      {items.reduce((sum, initiative) => sum + initiative.credits, 0)} CR
                    </span>
                  </div>

                  <div className="space-y-3">
                    {items.map((initiative) => {
                      const estimatedStatus = getEstimatedStatus(
                        initiative.est_start_date,
                        initiative.est_end_date,
                        initiative.status,
                      );

                      return (
                        <div
                          key={initiative.id}
                          className="rounded-[6px] border border-[#dfe3eb] bg-white p-4 shadow-[0_6px_18px_rgba(51,71,91,0.08)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-[13px] font-bold text-[#33475b]">
                                {initiative.title}
                              </h3>
                              <p className="mt-1 text-[11px] text-[#516f90]">
                                {initiative.description || "Sin descripcion ejecutiva."}
                              </p>
                            </div>
                            <span className="rounded-[3px] bg-[#eaf0f6] px-2 py-0.5 text-[10px] font-bold text-[#516f90]">
                              {initiative.credits} CR
                            </span>
                          </div>

                          <div className="mt-3 rounded-[3px] border border-[#f8c75c] bg-[#fff7dc] px-2 py-1 text-[10px] font-bold text-[#d97706]">
                            {estimatedStatus?.label ||
                              formatDateRange(initiative.est_start_date, initiative.est_end_date)}
                          </div>

                          {initiative.subitems.length ? (
                            <div className="mt-3 space-y-1">
                              {initiative.subitems.map((subitem) => (
                                <div
                                  key={subitem.id}
                                  className="flex items-center justify-between gap-3 rounded-[3px] bg-[#f8fbfd] px-2 py-1.5 text-[10px] text-[#33475b]"
                                >
                                  <span className="truncate">{subitem.name}</span>
                                  <span className="shrink-0 text-[#516f90]">
                                    {subitem.quantity} x {subitem.unit_credits} CR
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {!items.length ? (
                      <div className="rounded-[6px] border border-dashed border-[#cbd6e2] bg-white/90 px-4 py-6 text-center text-[12px] text-[#8aa0b4]">
                        Sin iniciativas
                      </div>
                    ) : null}

                    {audience === "client" && status === "backlog" ? (
                      <Card className="rounded-[10px] border border-dashed border-[#cbd6e2] bg-white p-4 shadow-none">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                          <Plus className="h-3.5 w-3.5" />
                          Proponer caso de uso
                        </div>
                        <div className="mt-3 space-y-3">
                          <Input
                            value={requestDraft.title}
                            onChange={(event) =>
                              setRequestDraft((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="Titulo del caso de uso"
                          />
                          <Textarea
                            rows={3}
                            value={requestDraft.description}
                            onChange={(event) =>
                              setRequestDraft((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            placeholder="Describe brevemente la necesidad o el resultado esperado."
                          />
                          <Button onClick={submitPublicRequest} disabled={isSubmitting}>
                            {isSubmitting ? "Enviando..." : "Crear en evaluación"}
                          </Button>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[20px] border border-[#dfe3eb] bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-[#eef6ff] text-[#3b82f6]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#33475b]">Acceso restringido</h2>
              <p className="mt-2 text-sm text-[#516f90]">
                Esta vista publica no permite editar etapas, mover tareas, cambiar creditos ni
                modificar configuraciones internas del onboarding.
              </p>
            </div>
          </div>
        </section>
      </main>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </div>
  );
}
