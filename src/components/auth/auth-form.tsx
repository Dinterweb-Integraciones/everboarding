"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DINTERWEB_EMAIL_DOMAIN } from "@/lib/auth-domain";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatUserError } from "@/lib/utils";

type AuthFormProps = {
  mode: "login" | "register";
};

export function AuthForm({ mode }: AuthFormProps) {
  const supabase = createSupabaseBrowserClient();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "domain"
      ? `Solo puedes ingresar con una cuenta @${DINTERWEB_EMAIL_DOMAIN}.`
      : null,
  );
  const [isLoading, setIsLoading] = useState(false);

  async function handleGoogleAccess() {
    setError(null);
    setIsLoading(true);

    try {
      const nextPath = searchParams.get("next") || "/dashboard";
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            hd: DINTERWEB_EMAIL_DOMAIN,
            prompt: "select_account",
          },
        },
      });

      if (oauthError) {
        throw oauthError;
      }
    } catch (caughtError) {
      setError(
        formatUserError(
          caughtError,
          "No fue posible abrir el acceso con Google. Intenta de nuevo.",
        ),
      );
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md overflow-hidden">
      <div className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(12,170,148,0.12),rgba(255,255,255,0.95))] px-6 py-6">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
          {mode === "login" ? "Acceso CS" : "Invitacion CS"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          {mode === "login" ? "Ingresa con Google" : "Activa tu acceso"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Plataforma operativa para Customer Success. Solo se permiten cuentas de{" "}
          <strong>@{DINTERWEB_EMAIL_DOMAIN}</strong>.
        </p>
      </div>
      <div className="space-y-5 px-6 py-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          Usa tu cuenta corporativa de Google para entrar. Si tu correo no pertenece a
          Dinterweb, el acceso sera rechazado.
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <Button className="w-full" disabled={isLoading} type="button" onClick={handleGoogleAccess}>
          <LogIn className="mr-2 h-4 w-4" />
          {isLoading ? "Redirigiendo..." : "Continuar con Google"}
        </Button>

        <p className="text-center text-sm text-slate-500">
          Si aun no tienes acceso con tu correo corporativo, pide que te habiliten dentro de
          Dinterweb.
        </p>
      </div>
    </Card>
  );
}
