import { notFound } from "next/navigation";

import { PublicOnboardingPage } from "@/components/onboarding/public-onboarding-page";
import { Card } from "@/components/ui/card";
import {
  calculateInitiativeProgress,
  type InitiativeRecord,
  type ClientBillingStatus,
  type OnboardingConfig,
  type PublicClientSummary,
  type PublicOnboardingAudience,
  type PublicOnboardingSnapshot,
  createDefaultBillingStatus,
} from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PublicSharedPageProps = {
  params: Promise<{
    audience: string;
    slug: string;
  }>;
};

type PublicOnboardingRpcResponse = {
  client: PublicClientSummary;
  config: OnboardingConfig;
  billing: ClientBillingStatus;
  initiatives: InitiativeRecord[];
  payment_email: string | null;
};

function isPublicAudience(value: string): value is PublicOnboardingAudience {
  return value === "client" || value === "prospect";
}

export default async function PublicSharedPage({ params }: PublicSharedPageProps) {
  const { audience, slug } = await params;

  if (!isPublicAudience(audience)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = (await supabase.rpc("get_public_onboarding_snapshot", {
    p_slug: slug,
  })) as {
    data: PublicOnboardingRpcResponse | null;
    error: Error | null;
  };

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#f5f8fa] px-6 py-16">
        <Card className="mx-auto max-w-2xl rounded-[24px] px-8 py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
            Enlace publico no valido
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-slate-950">
            No encontramos este onboarding publico.
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Revisa el enlace compartido o solicita una URL nueva.
          </p>
        </Card>
      </div>
    );
  }

  const snapshot: PublicOnboardingSnapshot = {
    client: data.client,
    config: data.config,
    billing: data.billing ?? createDefaultBillingStatus(data.config),
    initiatives: (data.initiatives ?? []).map((initiative) => ({
      ...initiative,
      labels: initiative.labels ?? [],
      subitems: initiative.subitems ?? [],
      logs: initiative.logs ?? [],
      credits: Number(initiative.credits ?? 0),
      progressPercent: Number(
        initiative.progressPercent ??
          calculateInitiativeProgress((initiative.subitems ?? []).map((subitem) => ({
            quantity: Number(subitem.quantity ?? 1),
            status: subitem.status ?? "pending",
          }))),
      ),
    })),
    paymentEmail: data.payment_email,
  };

  return (
    <PublicOnboardingPage
      audience={audience}
      publicSlug={slug}
      initialData={snapshot}
    />
  );
}
