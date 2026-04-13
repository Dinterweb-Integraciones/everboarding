"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { STATUS_META } from "@/lib/constants";
import type { InitiativeStatus } from "@/lib/onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatUserError } from "@/lib/utils";

type ClientGameplanModalProps = {
  clientId: string;
  clientName: string;
  isOpen: boolean;
  onClose: () => void;
};

type GameplanTask = {
  id: string;
  title: string;
  description: string | null;
  status: InitiativeStatus;
  est_start_date: string | null;
  est_end_date: string | null;
  is_blocked: boolean;
  sort_order: number;
};

const weekDays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("es-NI", {
    month: "long",
    year: "numeric",
  }).format(value);
}

function isTaskOnDate(task: GameplanTask, day: Date) {
  if (!task.est_start_date && !task.est_end_date) {
    return false;
  }

  const dayTime = parseIsoDate(toIsoDate(day)).getTime();
  const startTime = parseIsoDate(task.est_start_date ?? task.est_end_date ?? "").getTime();
  const endTime = parseIsoDate(task.est_end_date ?? task.est_start_date ?? "").getTime();

  return dayTime >= Math.min(startTime, endTime) && dayTime <= Math.max(startTime, endTime);
}

function getStatusClass(status: InitiativeStatus) {
  if (status === "executing") return "border-l-[#00bda5] bg-emerald-50 text-emerald-800";
  if (status === "planned") return "border-l-[#6a78d1] bg-indigo-50 text-indigo-800";
  if (status === "completed") return "border-l-[#33475b] bg-slate-100 text-slate-800";
  return "border-l-[#cbd6e2] bg-white text-slate-700";
}

export function ClientGameplanModal({
  clientId,
  clientName,
  isOpen,
  onClose,
}: ClientGameplanModalProps) {
  const supabase = createSupabaseBrowserClient();
  const [tasks, setTasks] = useState<GameplanTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isMounted = true;

    async function loadGameplan() {
      setIsLoading(true);
      setFeedback(null);

      try {
        const { data, error } = await supabase
          .from("onboarding_initiatives")
          .select("id, title, description, status, est_start_date, est_end_date, is_blocked, sort_order")
          .eq("client_id", clientId)
          .order("est_start_date", { ascending: true, nullsFirst: false })
          .order("sort_order", { ascending: true });

        if (error) {
          throw error;
        }

        if (!isMounted) {
          return;
        }

        const loadedTasks = (data ?? []) as GameplanTask[];
        setTasks(loadedTasks);

        const firstDatedTask = loadedTasks.find((task) => task.est_start_date || task.est_end_date);
        if (firstDatedTask) {
          const firstDate = parseIsoDate(firstDatedTask.est_start_date ?? firstDatedTask.est_end_date ?? "");
          setCurrentMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
        }
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }

        setFeedback({
          tone: "error",
          message: formatUserError(caughtError, "No fue posible cargar el gameplan."),
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadGameplan();

    return () => {
      isMounted = false;
    };
  }, [clientId, isOpen, supabase]);

  const calendarDays = useMemo(() => {
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const calendarStart = new Date(monthStart);
    calendarStart.setDate(monthStart.getDate() - monthStart.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(calendarStart);
      day.setDate(calendarStart.getDate() + index);
      return day;
    });
  }, [currentMonth]);

  const unscheduledTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== "completed" &&
          !task.est_start_date &&
          !task.est_end_date,
      ),
    [tasks],
  );

  const statusTotals = useMemo(() => {
    return tasks.reduce(
      (accumulator, task) => {
        accumulator[task.status] += 1;
        return accumulator;
      },
      {
        backlog: 0,
        planned: 0,
        executing: 0,
        completed: 0,
      } satisfies Record<InitiativeStatus, number>,
    );
  }, [tasks]);

  function shiftMonth(direction: -1 | 1) {
    setCurrentMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
      <Card className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Gameplan
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-950">{clientName}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Calendario ejecutivo con las tareas creadas en el board de onboarding.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            Cerrar
          </Button>
        </div>

        {isLoading ? (
          <div className="flex min-h-80 items-center justify-center text-slate-500">
            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
            Cargando gameplan...
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="grid gap-3 md:grid-cols-4">
              {Object.entries(STATUS_META).map(([status, meta]) => (
                <div key={status} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {meta.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {statusTotals[status as InitiativeStatus]}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-[var(--accent)] shadow-sm">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Calendario
                  </p>
                  <h4 className="text-xl font-semibold capitalize text-slate-950">
                    {formatMonth(currentMonth)}
                  </h4>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Anterior
                </Button>
                <Button variant="secondary" onClick={() => shiftMonth(1)}>
                  Siguiente
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {weekDays.map((day) => (
                  <div
                    key={day}
                    className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-500"
                  >
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day) => {
                  const dayTasks = tasks.filter((task) => isTaskOnDate(task, day));
                  const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                  const isoDay = toIsoDate(day);

                  return (
                    <div
                      key={isoDay}
                      className={`min-h-36 border-b border-r border-slate-100 p-2 ${
                        isCurrentMonth ? "bg-white" : "bg-slate-50/70"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-sm font-semibold ${
                            isCurrentMonth ? "text-slate-800" : "text-slate-400"
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        {dayTasks.length ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {dayTasks.length}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {dayTasks.slice(0, 3).map((task) => (
                          <div
                            key={`${isoDay}-${task.id}`}
                            className={`rounded-xl border border-slate-200 border-l-4 px-2 py-1.5 text-left text-[11px] leading-4 ${getStatusClass(task.status)}`}
                            title={task.title}
                          >
                            <p className="line-clamp-2 font-semibold">{task.title}</p>
                            <p className="mt-0.5 text-[10px] opacity-75">
                              {STATUS_META[task.status].label}
                              {task.is_blocked ? " · Bloqueada" : ""}
                            </p>
                          </div>
                        ))}
                        {dayTasks.length > 3 ? (
                          <p className="text-[10px] font-semibold text-slate-400">
                            +{dayTasks.length - 3} más
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-slate-950">Tareas sin fecha</h4>
                  <p className="mt-1 text-sm text-slate-600">
                    Estas tareas existen en el board, pero aún no tienen rango estimado.
                  </p>
                </div>
                <Badge className="w-fit bg-white text-slate-700">
                  {unscheduledTasks.length} pendiente{unscheduledTasks.length === 1 ? "" : "s"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {unscheduledTasks.length ? (
                  unscheduledTasks.map((task) => (
                    <div
                      key={`unscheduled-${task.id}`}
                      className={`rounded-2xl border border-slate-200 border-l-4 px-4 py-3 ${getStatusClass(task.status)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{task.title}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            {task.description || "Sin descripción ejecutiva."}
                          </p>
                        </div>
                        <Badge className="shrink-0 bg-white text-slate-700">
                          {STATUS_META[task.status].label}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">
                    Todas las tareas del board tienen una fecha estimada.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
      </Card>
    </div>
  );
}
