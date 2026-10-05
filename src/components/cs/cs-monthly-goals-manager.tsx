"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Info, Target } from "lucide-react";
import { useState } from "react";

import { formatShortMonthLabel, type MonthlyGoalRow } from "@/lib/cs-monthly-goals";
import { formatUserError } from "@/lib/utils";
import { FeedbackToast } from "@/components/ui/feedback-toast";

type CsMonthlyGoalsManagerProps = {
  year: number;
  currentMonth: string;
  customerSuccess: Array<{ id: string; name: string }>;
  initialGoals: MonthlyGoalRow[];
};

type CellStatus = "saving" | "error";

function cellKey(csId: string, month: string) {
  return `${csId}:${month}`;
}

export function CsMonthlyGoalsManager({
  year,
  currentMonth,
  customerSuccess,
  initialGoals,
}: CsMonthlyGoalsManagerProps) {
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  // Metas guardadas (fuente de verdad) y lo que hay escrito en cada celda.
  const [savedGoals, setSavedGoals] = useState(
    () =>
      new Map(
        initialGoals.map((goal) => [
          cellKey(goal.customer_success_id, goal.month.slice(0, 7)),
          Number(goal.goal_credits),
        ]),
      ),
  );
  const [drafts, setDrafts] = useState(new Map<string, string>());
  const [statuses, setStatuses] = useState(new Map<string, CellStatus>());
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  function setStatus(key: string, status: CellStatus | null) {
    setStatuses((current) => {
      const next = new Map(current);
      if (status) next.set(key, status);
      else next.delete(key);
      return next;
    });
  }

  async function saveCell(csId: string, month: string) {
    const key = cellKey(csId, month);
    const draft = drafts.get(key);
    if (draft === undefined) return;

    const trimmed = draft.trim();
    const goalCredits = trimmed === "" ? null : Number(trimmed);
    if (goalCredits !== null && (!Number.isInteger(goalCredits) || goalCredits < 0)) {
      setStatus(key, "error");
      setFeedback({ tone: "error", message: "La meta debe ser un número entero de créditos." });
      return;
    }

    if (goalCredits === (savedGoals.get(key) ?? null)) {
      setDrafts((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      setStatus(key, null);
      return;
    }

    setStatus(key, "saving");
    try {
      const response = await fetch("/api/cs/monthly-goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerSuccessId: csId, month, goalCredits }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar la meta.");
      }

      setSavedGoals((current) => {
        const next = new Map(current);
        if (goalCredits === null) next.delete(key);
        else next.set(key, goalCredits);
        return next;
      });
      setDrafts((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      setStatus(key, null);
    } catch (caughtError) {
      setStatus(key, "error");
      setFeedback({ tone: "error", message: formatUserError(caughtError, "No pudimos guardar la meta.") });
    }
  }

  const monthTotals = months.map((month) =>
    customerSuccess.reduce((sum, cs) => sum + (savedGoals.get(cellKey(cs.id, month)) ?? 0), 0),
  );

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Customer Success
                </p>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-slate-900">Metas mensuales</h1>
                  <span
                    tabIndex={0}
                    aria-label="Información sobre las metas mensuales"
                    className="group relative inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <Info className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-[4px] bg-[#213343] px-3 py-2 text-xs font-semibold leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    >
                      Define cuántos créditos de casos de uso debe completar cada CS en cada mes. El
                      informe de progreso compara contra esta meta los créditos completados en el mes
                      calendario. Los cambios se guardan al salir de cada celda; deja la celda vacía
                      para quitar la meta.
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/cs/metas?anio=${year - 1}`}
                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                aria-label="Año anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-16 text-center text-lg font-black text-slate-900">{year}</span>
              <Link
                href={`/cs/metas?anio=${year + 1}`}
                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                aria-label="Año siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {customerSuccess.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              No hay Customer Success activos.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left">CS</th>
                    {months.map((month) => (
                      <th
                        key={month}
                        className={`px-2 py-3 text-center ${month === currentMonth ? "text-[var(--accent)]" : ""}`}
                      >
                        {formatShortMonthLabel(month)}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customerSuccess.map((cs) => {
                    const yearTotal = months.reduce(
                      (sum, month) => sum + (savedGoals.get(cellKey(cs.id, month)) ?? 0),
                      0,
                    );

                    return (
                      <tr key={cs.id}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 font-black text-slate-900">
                          {cs.name}
                        </td>
                        {months.map((month) => {
                          const key = cellKey(cs.id, month);
                          const status = statuses.get(key);
                          const value = drafts.get(key) ?? String(savedGoals.get(key) ?? "");

                          return (
                            <td key={month} className="px-1 py-2">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                value={value}
                                placeholder="—"
                                aria-label={`Meta de ${cs.name} para ${formatShortMonthLabel(month)} ${year}`}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setDrafts((current) => new Map(current).set(key, nextValue));
                                }}
                                onBlur={() => void saveCell(cs.id, month)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                className={`h-9 w-20 rounded-lg border px-2 text-right text-sm font-semibold text-slate-800 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_20%,white)] ${
                                  status === "error"
                                    ? "border-rose-400 bg-rose-50"
                                    : status === "saving"
                                      ? "border-slate-200 bg-slate-50 text-slate-400"
                                      : month === currentMonth
                                        ? "border-[color-mix(in_oklab,var(--accent)_35%,white)] bg-white"
                                        : "border-slate-200 bg-white"
                                }`}
                              />
                            </td>
                          );
                        })}
                        <td className="whitespace-nowrap px-4 py-2 text-right font-black text-slate-900">
                          {yearTotal.toLocaleString("es-CR")} CR
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 text-xs font-black text-slate-700">
                  <tr>
                    <td className="sticky left-0 z-10 bg-slate-50 px-4 py-3 uppercase tracking-[0.14em]">
                      Total
                    </td>
                    {monthTotals.map((total, index) => (
                      <td key={months[index]} className="px-2 py-3 text-right">
                        {total ? total.toLocaleString("es-CR") : "—"}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {monthTotals.reduce((sum, total) => sum + total, 0).toLocaleString("es-CR")} CR
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
