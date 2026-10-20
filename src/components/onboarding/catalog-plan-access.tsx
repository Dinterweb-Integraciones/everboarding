"use client";

import { Lock, X } from "lucide-react";

export function EverboardingOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#c7c4f0] bg-[#f3f2fd] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#5c6ac4]">
      <Lock className="h-2.5 w-2.5" />
      Solo Everboarding
    </span>
  );
}

// Aviso al abrir un caso de uso solo Everboarding siendo cliente de paquetes.
export function EverboardingOnlyModal({
  useCaseName,
  onClose,
}: {
  useCaseName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#33475b]/50 px-4 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0" aria-label="Cerrar aviso" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="everboarding-only-title"
        className="relative w-full max-w-[420px] rounded-[10px] border border-[#dfe3eb] bg-white p-6 shadow-[0_24px_60px_rgba(51,71,91,0.25)]"
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
          <Lock className="h-5 w-5" />
        </span>
        <h3 id="everboarding-only-title" className="mt-4 text-[18px] font-extrabold leading-snug text-[#33475b]">
          Disponible solo con el plan Everboarding
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[#516f90]">
          <span className="font-bold text-[#33475b]">{useCaseName}</span> está disponible solo para
          clientes con el plan Everboarding.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[6px] border border-[#dfe3eb] bg-white px-5 py-3 text-[13px] font-bold text-[#516f90] transition hover:bg-[#f5f8fa]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
