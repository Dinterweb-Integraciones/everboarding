"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatUserError } from "@/lib/utils";

type AuthFormProps = {
  mode: "login" | "register";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setIsLoading(true);

    try {
      if (mode === "register") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
          return;
        }

        setInfo(
          "Tu cuenta fue creada. Si tu acceso requiere confirmacion por correo, revisa tu bandeja para continuar.",
        );
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        router.replace("/dashboard");
        router.refresh();
      }
    } catch (caughtError) {
      const message = formatUserError(
        caughtError,
        "No fue posible completar el acceso. Intenta de nuevo.",
      );
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md overflow-hidden">
      <div className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(12,170,148,0.12),rgba(255,255,255,0.95))] px-6 py-6">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
          {mode === "login" ? "Acceso" : "Registro"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          {mode === "login" ? "Entra a tu tablero" : "Crea tu cuenta"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Administra clientes, onboarding y enlaces compartidos desde una sola aplicacion.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
        {mode === "register" ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Nombre</span>
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Tu nombre"
              autoComplete="name"
              required
            />
          </label>
        ) : null}

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nombre@empresa.com"
            autoComplete="email"
            required
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Contrasena</span>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Minimo 6 caracteres"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {info ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {info}
          </div>
        ) : null}

        <Button className="w-full" disabled={isLoading} type="submit">
          {isLoading
            ? mode === "login"
              ? "Ingresando..."
              : "Creando cuenta..."
            : mode === "login"
              ? "Entrar"
              : "Crear cuenta"}
        </Button>

        <p className="text-center text-sm text-slate-500">
          {mode === "login" ? "Aun no tienes cuenta?" : "Ya tienes cuenta?"}{" "}
          <Link
            href={mode === "login" ? "/register" : "/login"}
            className="font-semibold text-[var(--accent)] hover:text-[var(--accent-strong)]"
          >
            {mode === "login" ? "Registrate" : "Inicia sesion"}
          </Link>
        </p>
      </form>
    </Card>
  );
}
