"use client";

import { ArrowRight, Check, Lock, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";

import { applyPackageCreditPricing, getPlanPeriodLabel, type CatalogModalGroup } from "@/lib/onboarding";
import { DEFAULT_RECURRENCE_OFFER, type RecurrenceOffer } from "@/lib/recurrence-offer";
import { formatCurrency } from "@/lib/utils";

// Precio en créditos de un caso de uso del catálogo. group.credits es lo que paga el cliente y
// group.baseCredits el valor base (suscripción Everboarding) cuando difiere: clientes de paquetes,
// ver applyPackageCreditPricing.
// - Cliente: en grande lo que paga. Debajo, si es de paquetes, lo que pagaría con Everboarding; si
//   tiene suscripción (showPackagePrice), cuánto se ahorra frente a paquetes.
// - CS (viewer "cs"): en grande el valor base, el que suma a su meta, y debajo, si el cliente paga
//   más (paquetes), cuánto paga.
export function CatalogCreditPrice({
  group,
  showPackagePrice,
  viewer = "client",
  muted = false,
  size = "card",
  onEverboardingClick,
}: {
  group: CatalogModalGroup;
  showPackagePrice: boolean;
  viewer?: "client" | "cs";
  muted?: boolean;
  size?: "card" | "large";
  // Con este handler, "X CR con Everboarding" se vuelve clickeable (abre la oferta de suscripción).
  onEverboardingClick?: () => void;
}) {
  const credits = group.credits;
  const baseCredits = group.baseCredits ?? credits;
  const hasPackageMarkup = credits > baseCredits;
  const isCsViewer = viewer === "cs";
  const packagePrice =
    showPackagePrice && !hasPackageMarkup && !isCsViewer
      ? applyPackageCreditPricing(group).credits
      : 0;
  const packageSavings = packagePrice - credits;
  const isLarge = size === "large";
  const priceColor = muted ? "text-[#9aa9b9]" : isLarge ? "text-[#00bda5]" : "text-[#ff7a59]";
  const noteClassName = `inline-flex items-center gap-1 whitespace-nowrap ${
    isLarge ? "text-[13px]" : "text-[10px]"
  } font-semibold`;

  return (
    <span
      className={`inline-flex flex-col ${isLarge ? "items-end gap-1" : "items-start gap-0.5"}`}
      title={isCsViewer ? "Valor base: el que suma a tu meta" : undefined}
    >
      <span className={`${isLarge ? "text-[28px]" : "text-[17px]"} font-extrabold leading-none ${priceColor}`}>
        {isCsViewer ? baseCredits : credits} CR
      </span>
      {hasPackageMarkup && isCsViewer ? (
        <span className={`${noteClassName} ${muted ? "text-[#9aa9b9]" : "text-[#516f90]"}`}>
          Cliente sin Everboarding: {credits} CR
        </span>
      ) : hasPackageMarkup && onEverboardingClick ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEverboardingClick();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          title="Conoce la suscripción Everboarding"
          className="cursor-pointer rounded-[2px] p-0 text-left"
        >
          {/* El texto va en un span: la regla global button { font: inherit } pisaría su tamaño. */}
          <span
            className={`${noteClassName} underline decoration-dotted underline-offset-2 transition ${
              muted ? "text-[#9aa9b9] hover:text-[#5c6ac4]" : "text-[#5c6ac4] hover:text-[#3f4bb0]"
            }`}
          >
            <Sparkles className={isLarge ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
            {baseCredits} CR con Everboarding
          </span>
        </button>
      ) : hasPackageMarkup ? (
        <span className={`${noteClassName} ${muted ? "text-[#9aa9b9]" : "text-[#5c6ac4]"}`}>
          <Sparkles className={isLarge ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
          {baseCredits} CR con Everboarding
        </span>
      ) : packageSavings > 0 ? (
        <span
          className={`${noteClassName} rounded-full px-1.5 py-px ${
            muted ? "bg-[#eef2f6] text-[#9aa9b9]" : "bg-[#e5f8f6] text-[#00897b]"
          }`}
        >
          Ahorras {packageSavings} CR vs. paquete
        </span>
      ) : null}
    </span>
  );
}

type CatalogCardStatus = "available" | "added" | "locked";
type CatalogCardActionTone = "primary" | "neutral" | "locked" | "danger";

const CATALOG_CARD_STATUS: Record<CatalogCardStatus, { label: string; className: string }> = {
  available: { label: "Disponible", className: "border-[#99f6e4] bg-[#f0fdfa] text-[#00a38d]" },
  added: { label: "Ya agregado", className: "border-[#d7dee8] bg-[#eef2f6] text-[#7c8da1]" },
  locked: { label: "Bloqueado", className: "border-[#c7c4f0] bg-[#f3f2fd] text-[#5c6ac4]" },
};

const CATALOG_CARD_ACTION: Record<CatalogCardActionTone, string> = {
  primary: "border-[#99f6e4] bg-[#f0fdfa] text-[#00a38d] hover:border-[#5eead4] hover:bg-[#e6fbf7]",
  neutral: "border-[#d7dee8] bg-white text-[#516f90] hover:bg-[#f5f8fa]",
  locked: "border-[#c7c4f0] bg-white text-[#5c6ac4] hover:bg-[#f3f2fd]",
  danger: "border-[#fecaca] bg-white text-[#dc2626] hover:border-[#fca5a5] hover:bg-[#fff5f5]",
};

// Pie de las tarjetas del catálogo: precio y estado en una fila, la acción debajo a lo ancho.
export function CatalogCardFooter({
  price,
  status,
  statusLabel,
  actionLabel = "Ver detalles",
  actionTone,
  onAction,
  actionDisabled = false,
}: {
  price: ReactNode;
  status: CatalogCardStatus;
  statusLabel?: string;
  actionLabel?: string;
  actionTone?: CatalogCardActionTone;
  onAction: () => void;
  actionDisabled?: boolean;
}) {
  const statusMeta = CATALOG_CARD_STATUS[status];
  const tone = actionTone ?? (status === "available" ? "primary" : status === "locked" ? "locked" : "neutral");

  return (
    <div className="mt-auto border-t border-[#eaf0f6] pt-3.5">
      <div className="flex items-start justify-between gap-3">
        {price}
        <span
          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusMeta.className}`}
        >
          {status === "available" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          ) : status === "added" ? (
            <Check className="h-3 w-3" />
          ) : (
            <Lock className="h-2.5 w-2.5" />
          )}
          {statusLabel ?? statusMeta.label}
        </span>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAction();
        }}
        disabled={actionDisabled}
        className={`mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] border text-[11px] font-bold leading-none transition disabled:cursor-not-allowed disabled:opacity-60 ${CATALOG_CARD_ACTION[tone]}`}
      >
        {actionLabel}
        {tone === "danger" ? null : <ArrowRight className="h-3 w-3" />}
      </button>
    </div>
  );
}

export function EverboardingOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#c7c4f0] bg-[#f3f2fd] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#5c6ac4]">
      <Lock className="h-2.5 w-2.5" />
      Solo Everboarding
    </span>
  );
}

// Aviso al abrir un caso de uso solo Everboarding siendo cliente de paquetes: presenta la
// suscripción con la oferta de recurrencia del cliente (o la oferta por defecto). Con onJoin (vista
// pública con oferta de recurrencia) se activa ahí mismo.
export function EverboardingOnlyModal({
  offer,
  onClose,
  onJoin,
  isJoining = false,
}: {
  offer?: Pick<RecurrenceOffer, "credits" | "price" | "periodMonths" | "creditSavingsPercent"> | null;
  onClose: () => void;
  onJoin?: () => void;
  isJoining?: boolean;
}) {
  const { credits, price, periodMonths, creditSavingsPercent } = offer ?? DEFAULT_RECURRENCE_OFFER;
  const periodLabel = getPlanPeriodLabel(periodMonths);
  // La suscripción se renueva el mismo día del mes en que se activa.
  const renewalDay = new Date().getDate();
  const benefits = [
    {
      title: "Ahorro de créditos",
      description: `cada caso de uso te cuesta ${creditSavingsPercent || DEFAULT_RECURRENCE_OFFER.creditSavingsPercent}% menos, así que lo que ya inviertes rinde más.`,
    },
    {
      title: "Casos de uso avanzados",
      description: "exclusivos para suscriptores, para ir más a fondo en los procesos que quieres mejorar.",
    },
    {
      title: "El mismo equipo siempre",
      description: "conoce tu operación y a tu gente, así que cada mes se avanza desde donde se quedó.",
    },
    {
      title: "Más tiempo para usar tus créditos",
      description: "90 días de vigencia, en vez de 60.",
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#33475b]/50 px-4 py-6 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0" aria-label="Cerrar aviso" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="everboarding-only-title"
        className="relative max-h-full w-full max-w-[520px] overflow-y-auto rounded-[10px] border border-[#dfe3eb] bg-white p-6 shadow-[0_24px_60px_rgba(51,71,91,0.25)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 rounded-[2px] p-1 text-[#9cb1c6] hover:text-[#33475b]"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#f3f2fd] text-[#5c6ac4]">
          <Sparkles className="h-5 w-5" />
        </span>
        <h3 id="everboarding-only-title" className="mt-4 pr-6 text-[19px] font-extrabold leading-snug text-[#33475b]">
          Casos de uso avanzados. Ahorro de créditos. El mismo equipo, mes a mes.
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[#516f90]">
          Everboarding es la suscripción mensual para que tu operación siga mejorando sobre todo lo que ya
          construiste.
        </p>
        <ul className="mt-5 space-y-2.5">
          {benefits.map((benefit) => (
            <li key={benefit.title} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[#516f90]">
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#e5f8f6] text-[#00a38d]">
                <Check className="h-3 w-3" />
              </span>
              <span>
                <span className="font-bold text-[#33475b]">{benefit.title}:</span> {benefit.description}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 rounded-[8px] border border-[#c7c4f0] bg-[#f8f7fe] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5c6ac4]">Qué pasa al activarla</p>
          <p className="mt-1.5 text-[15px] font-extrabold text-[#33475b]">
            {formatCurrency(price)} al {periodLabel} · {credits} créditos cada {periodLabel}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#516f90]">
            Tus créditos actuales se quedan y se suman a los nuevos, y ahorras en los casos de uso que agregues
            desde que la activas. Tu suscripción se renueva automáticamente el día {renewalDay}{" "}
            {periodMonths === 1 ? "de cada mes" : `de cada ${periodLabel}`} con tu método de pago registrado, y ese
            mismo día recibes {credits} créditos para seguir sumando casos de uso.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          {onJoin ? (
            <>
              <button
                type="button"
                onClick={onJoin}
                disabled={isJoining}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[6px] bg-gradient-to-r from-[#00bda5] via-[#00a4bd] to-[#5c6ac4] px-5 py-3 text-[14px] font-extrabold text-white shadow-md transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Sparkles className="h-4 w-4" />
                <span className="text-[14px] font-extrabold">
                  {isJoining ? "Abriendo el pago..." : "Activar suscripción Everboarding"}
                </span>
              </button>
              <p className="text-center text-[11px] font-semibold text-[#7c8da1]">
                Sin contrato. Cancelas cuando quieras.
              </p>
            </>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[6px] border border-[#dfe3eb] bg-white px-5 py-3 text-[13px] font-bold text-[#516f90] transition hover:bg-[#f5f8fa]"
          >
            <span className="text-[13px] font-bold">Seguir con paquetes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
