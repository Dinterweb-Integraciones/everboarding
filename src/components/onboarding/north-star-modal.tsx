"use client";

import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { NorthStarHistoryRecord, NorthStarLifecycleStatus, NorthStarStatus } from "@/lib/onboarding";

type NorthStarModalProps = {
  role: "cs" | "client";
  status: NorthStarStatus;
  lifecycleStatus?: NorthStarLifecycleStatus;
  text: string;
  history?: NorthStarHistoryRecord[];
  dismissalsRemaining: number;
  isSaving: boolean;
  isBlocking?: boolean;
  onTextChange?: (value: string) => void;
  onDismiss: () => void;
  onCsPreapprove?: () => void;
  onCsSave?: () => void;
  onClientApprove?: () => void;
  onCsComplete?: () => void;
  onFulfillmentChange?: (fulfilled: boolean) => void;
};

function getStatusLabel(status: NorthStarStatus) {
  if (status === "completed") return "Completado";
  if (status === "client_approved") return "Aprobado por cliente";
  if (status === "cs_preapproved") return "Enviado al cliente";
  return "Pendiente";
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat("es-NI", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getHistoryStateLabel(entry: NorthStarHistoryRecord) {
  if (entry.north_star_lifecycle_status === "fulfilled") return "Cumplido";
  if (entry.north_star_status === "client_approved" || entry.north_star_status === "completed") {
    return "Validado";
  }
  return "Propuesta";
}

function getGuidance(role: NorthStarModalProps["role"], status: NorthStarStatus) {
  if (status === "pending") {
    return role === "cs"
      ? "Redacta El Norte con el cliente y envialo para su aprobacion."
      : "El Customer Success esta preparando El Norte para que puedas aprobarlo.";
  }

  if (status === "cs_preapproved") {
    return role === "client"
      ? "Revisa la definicion consensuada y apruebala si representa lo acordado."
      : "Comparte el enlace del cliente. La aprobacion final se habilitara cuando el cliente acepte.";
  }

  if (status === "client_approved") {
    return role === "cs"
      ? "El cliente ya lo aprobo. Confirma la aceptacion final para desbloquear el avance."
      : "Aprobado de tu lado. El Customer Success debe hacer la aceptacion final.";
  }

  return "El Norte ya esta definido y consensuado.";
}

export function NorthStarModal({
  role,
  status,
  lifecycleStatus = "active",
  text,
  history = [],
  dismissalsRemaining,
  isSaving,
  isBlocking = true,
  onTextChange,
  onDismiss,
  onCsPreapprove,
  onCsSave,
  onClientApprove,
  onCsComplete,
  onFulfillmentChange,
}: NorthStarModalProps) {
  const canDismiss = !isBlocking || (dismissalsRemaining > 0 && status !== "completed");
  const canEdit =
    role === "cs" &&
    (!isBlocking || status === "pending" || status === "cs_preapproved");
  const trimmedText = text.trim();
  let primaryAction: ReactNode = null;

  if (role === "cs" && (status === "pending" || status === "cs_preapproved")) {
    primaryAction = (
      <Button
        className="h-16 w-full flex-col gap-1 rounded-[6px] px-2 text-[11px]"
        onClick={onCsPreapprove}
        disabled={isSaving || trimmedText.length < 12}
        aria-label="Enviar El Norte al cliente"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5" /><span>Enviar al cliente</span></>}
      </Button>
    );
  } else if (role === "cs" && status === "client_approved") {
    primaryAction = (
      <Button
        className="h-16 w-full flex-col gap-1 rounded-[6px] px-2 text-[11px]"
        onClick={onCsComplete}
        disabled={isSaving || !trimmedText}
        aria-label="Aceptar definitivamente El Norte"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5" /><span>Aprobar por CS</span></>}
      </Button>
    );
  } else if (role === "cs" && !isBlocking) {
    primaryAction = (
      <Button
        className="h-16 w-full flex-col gap-1 rounded-[6px] px-2 text-[11px]"
        onClick={onCsSave}
        disabled={isSaving || trimmedText.length < 12}
        aria-label="Guardar El Norte"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5" /><span>Guardar</span></>}
      </Button>
    );
  } else if (role === "client" && status === "cs_preapproved") {
    primaryAction = (
      <Button
        className="h-16 w-full flex-col gap-1 rounded-[6px] px-2 text-[11px]"
        onClick={onClientApprove}
        disabled={isSaving || !trimmedText}
        aria-label="Aprobar El Norte"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5" /><span>Aprobar Norte</span></>}
      </Button>
    );
  }

  const canManageFulfillment = role === "cs" && status === "completed";
  const shouldClientValidateFulfillment = role === "client" && status === "completed" && lifecycleStatus === "fulfilled";
  const showFulfillmentActions = canManageFulfillment || shouldClientValidateFulfillment;
  const historyEntries = history.filter((entry) => entry.north_star_lifecycle_status !== "active");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#33475b]/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[980px] rounded-[8px] border border-[#dfe3eb] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00a88f]">
              El Norte
            </p>
            <h2 className="mt-1 text-[20px] font-extrabold text-[#33475b]">
              Definamos el resultado que guia el servicio
            </h2>
            <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-[#516f90]">
              {getGuidance(role, status)}
            </p>
          </div>
          <span className="rounded-[4px] border border-[#dfe3eb] bg-[#f5f8fa] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#516f90]">
            {getStatusLabel(status)}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_112px]">
          {canEdit ? (
            <Textarea
              value={text}
              onChange={(event) => onTextChange?.(event.target.value)}
              placeholder="El Norte que guia nuestro trabajo juntos. Que queremos lograr, y por que importa?"
              className="min-h-[220px] resize-y rounded-[4px] border-[#cbd6e2] bg-white px-5 py-4 text-[16px] leading-7 text-[#33475b] shadow-none"
              disabled={isSaving}
            />
          ) : (
            <div className="min-h-[220px] whitespace-pre-wrap rounded-[4px] border border-[#cbd6e2] bg-[#f8fbff] px-5 py-4 text-[16px] leading-7 text-[#33475b]">
              {trimmedText || "El Norte todavia no ha sido enviado por Customer Success."}
            </div>
          )}

          <div className="flex flex-row gap-3 md:flex-col">
            {primaryAction}
            <button
              type="button"
              onClick={onDismiss}
              disabled={isSaving || !canDismiss}
              className="inline-flex h-16 w-full flex-col items-center justify-center rounded-[6px] border border-[#cbd6e2] bg-white px-3 text-[12px] font-bold text-[#516f90] transition hover:bg-[#f5f8fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>Cerrar</span>
              {isBlocking ? <span className="mt-0.5 text-[11px]">{dismissalsRemaining}/3</span> : null}
            </button>

            {showFulfillmentActions ? (
              <div className="grid w-full gap-2">
                <button
                  type="button"
                  onClick={() => onFulfillmentChange?.(true)}
                  disabled={isSaving || lifecycleStatus === "fulfilled"}
                  className={cn(
                    "inline-flex h-16 w-full items-center justify-center rounded-[6px] border px-3 text-center text-[12px] font-bold transition disabled:cursor-default",
                    lifecycleStatus === "fulfilled"
                      ? "border-[#00a88f] bg-[#00bda5] text-white shadow-sm"
                      : "border-[#00a88f] bg-[#e7fbf7] text-[#007a69] hover:bg-[#00bda5] hover:text-white",
                  )}
                >
                  Cumplido
                </button>
                <button
                  type="button"
                  onClick={() => onFulfillmentChange?.(false)}
                  disabled={isSaving || lifecycleStatus === "active"}
                  className={cn(
                    "inline-flex h-16 w-full items-center justify-center rounded-[6px] border px-3 text-center text-[12px] font-bold transition disabled:cursor-default",
                    lifecycleStatus === "active"
                      ? "border-[#f59e0b] bg-[#fffbeb] text-[#b45309]"
                      : "border-[#f59e0b] bg-white text-[#b45309] hover:bg-[#f59e0b] hover:text-white",
                  )}
                >
                  No cumplido
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isBlocking && !canDismiss ? (
          <p className="mt-4 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-700">
            Ya se usaron los 3 cierres disponibles. Para continuar, primero debe definirse y aprobarse El Norte.
          </p>
        ) : null}

        {role === "cs" && trimmedText ? (
          <section className="mt-5 border-t border-[#dfe3eb] pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[#33475b]">
                Historial de Nortes
              </h3>
              <span className="text-[11px] font-semibold text-[#516f90]">
                {historyEntries.length ? `${historyEntries.length} versiones` : "Sin versiones previas"}
              </span>
            </div>

            {historyEntries.length ? (
              <div className="max-h-[260px] space-y-3 overflow-y-auto pr-1">
                {historyEntries.map((entry, index) => (
                  <article
                    key={entry.id}
                    className="rounded-[4px] border border-[#dfe3eb] bg-[#f8fbff] px-4 py-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-extrabold text-[#33475b]">
                          {`Version ${historyEntries.length - index}`}
                        </span>
                        <span className="rounded-[3px] border border-[#dfe3eb] bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#516f90]">
                          {getHistoryStateLabel(entry)}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-[#7c98b6]">
                        {formatHistoryDate(entry.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-6 text-[#33475b]">
                      {entry.north_star_text}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-[4px] border border-dashed border-[#cbd6e2] bg-[#f8fbff] px-4 py-3 text-[12px] font-semibold text-[#516f90]">
                Las proximas ediciones de El Norte quedaran guardadas aqui.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
