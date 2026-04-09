import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(12,170,148,0.12),_transparent_35%),linear-gradient(180deg,#f7faf9_0%,#eef5f3_100%)] px-4">
      <Card className="max-w-lg px-8 py-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
          Recurso no encontrado
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">
          Este onboarding ya no existe o no tienes permiso para verlo.
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Verifica el enlace compartido o vuelve al dashboard para abrir un cliente valido.
        </p>
        <div className="mt-8">
          <Link href="/dashboard">
            <Button>Volver al dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
