"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

type FeedbackToastProps = {
  feedback: {
    tone: "success" | "error";
    message: string;
  } | null;
  onClose: () => void;
};

export function FeedbackToast({ feedback, onClose }: FeedbackToastProps) {
  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      onClose();
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [feedback, onClose]);

  if (!feedback) {
    return null;
  }

  const isSuccess = feedback.tone === "success";

  return (
    <div className="fixed bottom-5 right-5 z-[70] max-w-sm">
      <div
        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.18)] backdrop-blur-sm ${
          isSuccess
            ? "border-emerald-200 bg-white text-emerald-700"
            : "border-rose-200 bg-white text-rose-700"
        }`}
        role="status"
        aria-live="polite"
      >
        <div
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
            isSuccess ? "bg-emerald-50" : "bg-rose-50"
          }`}
        >
          {isSuccess ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {isSuccess ? "Acción completada" : "Ocurrió un problema"}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{feedback.message}</p>
        </div>

        <Button
          variant="ghost"
          className="h-8 w-8 rounded-full p-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
          aria-label="Cerrar notificación"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
