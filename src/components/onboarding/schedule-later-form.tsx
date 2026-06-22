"use client";

import { ArrowLeft, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatUserError } from "@/lib/utils";

type ScheduleLaterFormProps = {
  defaultEmail: string;
  audience: string;
  publicSlug: string;
  publicProposalUrl: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ScheduleLaterForm({
  defaultEmail,
  audience,
  publicSlug,
  publicProposalUrl,
}: ScheduleLaterFormProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const trimmedEmail = email.trim();
  const emailIsValid = isValidEmail(trimmedEmail);

  async function saveKickoffContact() {
    if (!emailIsValid || isSaving) {
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/public-onboarding/${audience}/${publicSlug}/kickoff-contact`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contactEmail: trimmedEmail,
          }),
        },
      );
      const payload = (await response.json()) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar el correo.");
      }

      setFeedback({
        tone: "success",
        message:
          payload.message ||
          "Listo. Guardamos este correo para coordinar la kickoff.",
      });
      window.setTimeout(() => {
        window.location.assign(`/public/${audience}/${publicSlug}`);
      }, 900);
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(
          caughtError,
          "No pudimos guardar el correo para coordinar la kickoff.",
        ),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl text-center">
      <p className="text-sm font-black text-[#001d3d]">
        Prefiero agendar en otro momento
      </p>
      <p className="mt-2 text-xs leading-5 text-[#516f90]">
        Deja el correo del contacto principal y nuestro equipo le escribira para coordinar
        la kickoff.
      </p>

      <label className="mt-4 block text-[11px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
        Correo del contacto principal
      </label>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="nombre@empresa.com"
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#00bda5] focus:ring-2 focus:ring-[#d7fff9]"
      />

      <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row sm:items-center">
        <Link
          href={publicProposalUrl}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-[#33475b] transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a la propuesta
        </Link>

        <button
          type="button"
          onClick={saveKickoffContact}
          disabled={!emailIsValid || isSaving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#00bda5] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#00a48f] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 sm:w-auto"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {isSaving ? "Guardando..." : "Guardar correo de contacto"}
        </button>
      </div>

      {feedback ? (
        <p
          className={
            feedback.tone === "success"
              ? "mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
              : "mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
          }
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
