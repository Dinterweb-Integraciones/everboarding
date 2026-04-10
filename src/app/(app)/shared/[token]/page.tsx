import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

type SharedLinkPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams?: Promise<{
    stage?: string;
  }>;
};

export default async function SharedLinkPage({
  params,
  searchParams,
}: SharedLinkPageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { supabase } = await requireUser();
  const { data, error } = (await supabase.rpc("redeem_client_share_link", {
    p_token: token,
  })) as {
    data: string | null;
    error: Error | null;
  };

  if (error || !data) {
    return (
      <Card className="max-w-2xl px-8 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
          Enlace no valido
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">
          El enlace compartido no existe, expiro o fue revocado.
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Solicita un enlace nuevo y vuelve a intentarlo.
        </p>
      </Card>
    );
  }

  const stageParam = resolvedSearchParams?.stage ? `?stage=${resolvedSearchParams.stage}` : "";
  redirect(`/clients/${data}${stageParam}`);
}
