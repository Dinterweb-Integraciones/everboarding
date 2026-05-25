import { notFound } from "next/navigation";

import { PublicOnboardingPage } from "@/components/onboarding/public-onboarding-page";
import { Card } from "@/components/ui/card";
import {
  calculateInitiativeProgress,
  type CreditCatalogGroup,
  type CreditCatalogGroupCategory,
  type CreditCatalogGroupCategoryLink,
  type CreditCatalogCategory,
  type CreditCatalogGroupItem,
  type CreditCatalogItem,
  type InitiativeTaskStatus,
  type InitiativeRecord,
  type ClientBillingStatus,
  type OnboardingConfig,
  type PublicClientSummary,
  type PublicOnboardingAudience,
  type PublicOnboardingSnapshot,
  createDefaultBillingStatus,
} from "@/lib/onboarding";
import {
  buildPublicProspectSnapshotBase,
  getSalesProposalBySlug,
} from "@/lib/public-prospect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
  catalog: CreditCatalogItem[];
  catalog_categories: CreditCatalogCategory[];
  catalog_groups: CreditCatalogGroup[];
  catalog_group_categories: CreditCatalogGroupCategory[];
  catalog_group_category_links: CreditCatalogGroupCategoryLink[];
  catalog_group_memberships: CreditCatalogGroupItem[];
  payment_email: string | null;
};

function isPublicAudience(value: string): value is PublicOnboardingAudience {
  return value === "client" || value === "prospect";
}

function normalizeTaskStatus(value: string | null | undefined): InitiativeTaskStatus {
  if (value === "in_progress" || value === "blocked" || value === "completed") {
    return value;
  }

  return "pending";
}

export default async function PublicSharedPage({ params }: PublicSharedPageProps) {
  const { audience, slug } = await params;

  if (!isPublicAudience(audience)) {
    notFound();
  }

  const admin = createSupabaseAdminClient();
  const [
    prospectProposal,
    { data: catalogRows, error: catalogError },
    { data: catalogCategoryRows, error: catalogCategoriesError },
    { data: catalogGroupRows, error: catalogGroupsError },
    { data: catalogGroupCategoryRows, error: catalogGroupCategoriesError },
    { data: catalogGroupCategoryLinkRows, error: catalogGroupCategoryLinksError },
    { data: catalogGroupMembershipRows, error: catalogGroupMembershipsError },
  ] = await Promise.all([
    audience === "prospect" ? getSalesProposalBySlug(slug) : Promise.resolve(null),
    admin
      .from("credit_catalog_items")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true }),
    admin
      .from("credit_catalog_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("credit_catalog_groups")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("credit_catalog_group_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("credit_catalog_group_category_links")
      .select("*")
      .order("category_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    admin
      .from("credit_catalog_group_items")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (catalogError) {
    throw new Error("No pudimos cargar el catalogo publico de tareas.");
  }

  if (catalogCategoriesError) {
    throw new Error("No pudimos cargar las categorias del catalogo publico.");
  }

  if (catalogGroupsError) {
    throw new Error("No pudimos cargar los grupos del catalogo publico.");
  }

  if (catalogGroupCategoriesError) {
    throw new Error("No pudimos cargar las categorias de grupos del catalogo publico.");
  }

  if (catalogGroupCategoryLinksError) {
    throw new Error("No pudimos cargar la relacion entre grupos y categorias del catalogo publico.");
  }

  if (catalogGroupMembershipsError) {
    throw new Error("No pudimos cargar la relacion entre grupos y tareas del catalogo publico.");
  }

  const typedCatalogRows = (catalogRows ?? []) as CreditCatalogItem[];
  const typedCatalogCategoryRows = (catalogCategoryRows ?? []) as CreditCatalogCategory[];
  const typedCatalogGroupRows = (catalogGroupRows ?? []) as CreditCatalogGroup[];
  const typedCatalogGroupCategoryRows =
    (catalogGroupCategoryRows ?? []) as CreditCatalogGroupCategory[];
  const typedCatalogGroupCategoryLinkRows =
    (catalogGroupCategoryLinkRows ?? []) as CreditCatalogGroupCategoryLink[];
  const typedCatalogGroupMembershipRows =
    (catalogGroupMembershipRows ?? []) as CreditCatalogGroupItem[];

  if (prospectProposal) {
    const baseSnapshot = buildPublicProspectSnapshotBase(prospectProposal);
    const snapshot: PublicOnboardingSnapshot = {
      ...baseSnapshot,
      catalog: typedCatalogRows.map((item) => ({
        ...item,
        credits: Number(item.credits ?? 0),
        sort_order: Number(item.sort_order ?? 0),
      })),
      catalogCategories: typedCatalogCategoryRows.map((category) => ({
        ...category,
        sort_order: Number(category.sort_order ?? 0),
      })),
      catalogGroups: typedCatalogGroupRows.map((group) => ({
        ...group,
        credits: Number(group.credits ?? 0),
        sort_order: Number(group.sort_order ?? 0),
      })),
      catalogGroupCategories: typedCatalogGroupCategoryRows.map((category) => ({
        ...category,
        sort_order: Number(category.sort_order ?? 0),
      })),
      catalogGroupCategoryLinks: typedCatalogGroupCategoryLinkRows,
      catalogGroupMemberships: typedCatalogGroupMembershipRows.map((membership) => ({
        ...membership,
        sort_order: Number(membership.sort_order ?? 0),
      })),
    };

    return (
      <PublicOnboardingPage
        audience={audience}
        publicSlug={slug}
        initialData={snapshot}
      />
    );
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

  const billingResult = await admin.rpc("get_client_billing_status" as never, {
    p_client_id: data.client.id,
  } as never);
  const billingRow = (billingResult as { data: ClientBillingStatus | null }).data ?? null;

  const snapshot: PublicOnboardingSnapshot = {
    client: data.client,
    config: data.config,
    billing: billingRow ?? data.billing ?? createDefaultBillingStatus(data.config),
    initiatives: (data.initiatives ?? []).map((initiative) => ({
      ...initiative,
      status:
        initiative.status === "planned" ||
        initiative.status === "executing" ||
        initiative.status === "completed"
          ? initiative.status
          : "backlog",
      labels: initiative.labels ?? [],
      subitems: (initiative.subitems ?? []).map((subitem) => ({
        ...subitem,
        status: normalizeTaskStatus(subitem.status),
        quantity: Number(subitem.quantity ?? 1),
        unit_credits: Number(subitem.unit_credits ?? 0),
        target_date: subitem.target_date ?? null,
      })),
      logs: initiative.logs ?? [],
      credits: Number(initiative.credits ?? 0),
      progressPercent: Number(
        initiative.progressPercent ??
          calculateInitiativeProgress((initiative.subitems ?? []).map((subitem) => ({
            quantity: Number(subitem.quantity ?? 1),
            status: normalizeTaskStatus(subitem.status),
          }))),
      ),
    })),
    catalog: typedCatalogRows.map((item) => ({
      ...item,
      credits: Number(item.credits ?? 0),
      sort_order: Number(item.sort_order ?? 0),
    })),
    catalogCategories: typedCatalogCategoryRows.map((category) => ({
      ...category,
      sort_order: Number(category.sort_order ?? 0),
    })),
    catalogGroups: typedCatalogGroupRows.map((group) => ({
      ...group,
      credits: Number(group.credits ?? 0),
      sort_order: Number(group.sort_order ?? 0),
    })),
    catalogGroupCategories: typedCatalogGroupCategoryRows.map((category) => ({
      ...category,
      sort_order: Number(category.sort_order ?? 0),
    })),
    catalogGroupCategoryLinks: typedCatalogGroupCategoryLinkRows,
    catalogGroupMemberships: typedCatalogGroupMembershipRows.map((membership) => ({
      ...membership,
      sort_order: Number(membership.sort_order ?? 0),
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
