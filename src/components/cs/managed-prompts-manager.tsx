"use client";

import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FeedbackToast } from "@/components/ui/feedback-toast";
import { Textarea } from "@/components/ui/textarea";
import type { ManagedPrompt } from "@/lib/onboarding";
import { formatDate, formatUserError } from "@/lib/utils";

type ManagedPromptsManagerProps = {
  initialPrompt: ManagedPrompt | null;
  isStorageReady?: boolean;
  storageMessage?: string | null;
};

const emptyForm = {
  promptText: "",
};

export function ManagedPromptsManager({
  initialPrompt,
  isStorageReady = true,
  storageMessage = null,
}: ManagedPromptsManagerProps) {
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [form, setForm] = useState({
    promptText: initialPrompt?.prompt_text ?? emptyForm.promptText,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  function resetForm() {
    setForm({
      promptText: savedPrompt?.prompt_text ?? emptyForm.promptText,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/cs/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: form.promptText,
        }),
      });

      const payload = (await response.json()) as ManagedPrompt & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos guardar el prompt.");
      }

      setSavedPrompt(payload);
      setForm({ promptText: payload.prompt_text });
      setFeedback({
        tone: "success",
        message: savedPrompt ? "Prompt actualizado." : "Prompt guardado.",
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos guardar el prompt."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm("Eliminar el prompt actual?");
    if (!confirmed) return;

    try {
      const response = await fetch("/api/cs/prompts", {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "No pudimos eliminar el prompt.");
      }

      setSavedPrompt(null);
      setForm(emptyForm);
      setFeedback({ tone: "success", message: "Prompt eliminado." });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: formatUserError(caughtError, "No pudimos eliminar el prompt."),
      });
    }
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[var(--accent)]">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                CRUD CS
              </p>
              <h1 className="text-2xl font-black text-slate-900">Gestion de prompts</h1>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            Registra el prompt que quieras administrar
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Prompt
              </label>
              <Textarea
                rows={6}
                value={form.promptText}
                onChange={(event) => setForm({ promptText: event.target.value })}
                placeholder="Escribe aqui el prompt que quieres guardar y administrar."
                disabled={!isStorageReady}
              />
            </div>

            {storageMessage ? (
              <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {storageMessage}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving || !isStorageReady}>
                <Plus className="mr-2 h-4 w-4" />
                {isSaving ? "Guardando..." : savedPrompt ? "Actualizar prompt" : "Guardar prompt"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={resetForm}
                disabled={isSaving || !isStorageReady || (!savedPrompt && !form.promptText)}
              >
                {savedPrompt ? "Restaurar guardado" : "Limpiar"}
              </Button>
            </div>
          </form>
        </section>

        <section className="mt-6 rounded-[18px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                Prompt actual
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-900">Resumen guardado</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {savedPrompt ? "1 prompt" : "Sin prompt"}
            </span>
          </div>

          <div className="mt-5 rounded-[14px] border border-slate-200 bg-slate-50 p-5">
            {savedPrompt ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                    <span>Creado: {formatDate(savedPrompt.created_at)}</span>
                    <span>Actualizado: {formatDate(savedPrompt.updated_at)}</span>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={handleDelete}
                    disabled={!isStorageReady}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar prompt
                  </Button>
                </div>

                <div className="rounded-[12px] border border-slate-200 bg-white p-4">
                  <p className="whitespace-pre-wrap leading-7 text-slate-700">
                    {savedPrompt.prompt_text}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Aun no hay un prompt guardado.</p>
            )}
          </div>
        </section>
      </div>

      <FeedbackToast feedback={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
