import { notFound } from "next/navigation";

import { OnboardingClientPage } from "@/components/onboarding/onboarding-client-page";
import { requireUser } from "@/lib/auth";
import { fetchClientMembership } from "@/lib/membership-access";
import { canViewPrivateCatalogGroups } from "@/lib/platform-access";
import {
  createDefaultConfig,
  createDefaultBillingStatus,
  mapInitiative,
  resolveStageFromProfileRole,
  type ClientBillingStatus,
  type ClientMemberRecord,
  type ProjectStage,
  type ShareLinkRecord,
} from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Tables } from "@/types/database";

type ClientDetailPageProps = {
  params: Promise<{
    clientId: string;
  }>;
  searchParams?: Promise<{
    stage?: string;
  }>;
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: ClientDetailPageProps) {
  const { clientId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { supabase, user, platformProfile } = await requireUser();
  const admin = createSupabaseAdminClient();
  const platformRole = platformProfile?.platform_role ?? null;
  const canViewPrivateCatalog = canViewPrivateCatalogGroups(platformRole);
  const canBypassClientMembership = platformRole === "admin" || platformRole === "superadmin";
  const clientReader = canBypassClientMembership ? admin : supabase;

  const { data: client, error: clientError } = await clientReader
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) {
    throw new Error("No pudimos cargar este onboarding.");
  }

  const clientRecord = client as Tables<"clients"> | null;

  if (!clientRecord) {
    notFound();
  }

  const membershipLookup =
    canBypassClientMembership || clientRecord.owner_user_id === user.id
      ? null
      : await fetchClientMembership(supabase, clientRecord.id, user.id);

  const accessRole =
    clientRecord.owner_user_id === user.id
      ? "owner"
      : canBypassClientMembership
      ? "editor"
      : ((membershipLookup?.data as { access_role?: "viewer" | "editor" | "owner" } | null)
          ?.access_role ?? null);
  const membershipProfileRole =
    canBypassClientMembership
      ? "csm"
      : clientRecord.owner_user_id === user.id
      ? null
      : ((membershipLookup?.data as {
          profile_role?: "sales" | "csm" | "client" | "stakeholder";
        } | null)?.profile_role ?? null);

  if (!accessRole) {
    notFound();
  }

  const { data: configRow } = await clientReader
    .from("onboarding_configs")
    .select("*")
    .eq("client_id", clientRecord.id)
    .maybeSingle();

  const { data: initiativeRows } = await clientReader
    .from("onboarding_initiatives")
    .select("*")
    .eq("client_id", clientRecord.id)
    .order("sort_order", { ascending: true });

  const initiativeRecords = (initiativeRows ?? []) as Tables<"onboarding_initiatives">[];
  const initiativeIds = initiativeRecords.map((initiative) => initiative.id);

  const [
    { data: subitemRows, error: subitemsError },
    { data: logRows, error: logsError },
    { data: northStarHistoryRows, error: northStarHistoryError },
    { data: catalogRows, error: catalogError },
  ] = await Promise.all([
    initiativeIds.length
      ? clientReader
          .from("onboarding_initiative_subitems")
          .select("*")
          .in("initiative_id", initiativeIds)
      : Promise.resolve({ data: [], error: null }),
    initiativeIds.length
      ? clientReader
          .from("onboarding_activity_logs")
          .select("*")
          .in("initiative_id", initiativeIds)
      : Promise.resolve({ data: [], error: null }),
    clientReader
      .from("onboarding_north_star_history")
      .select("*")
      .eq("client_id", clientRecord.id)
      .order("created_at", { ascending: false }),
    admin
      .from("credit_catalog_items")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true }),
  ]);

  const [
    { data: catalogGroupRows, error: catalogGroupsError },
    { data: catalogGroupCategoryRows, error: catalogGroupCategoriesError },
    { data: catalogGroupCategoryLinkRows, error: catalogGroupCategoryLinksError },
    { data: catalogGroupMembershipRows, error: catalogGroupMembershipsError },
  ] = await Promise.all([
    admin.from("credit_catalog_groups").select("*").eq("is_active", true).order("sort_order").order("name"),
    admin.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
    admin.from("credit_catalog_group_category_links").select("*").order("category_id").order("sort_order").order("created_at"),
    admin.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
  ]);

  if (subitemsError) {
    throw new Error("No pudimos cargar las tareas de las iniciativas.");
  }

  if (logsError) {
    throw new Error("No pudimos cargar el historial del onboarding.");
  }

  if (northStarHistoryError) {
    throw new Error("No pudimos cargar el historial de El Norte.");
  }

  if (catalogError) {
    throw new Error("No pudimos cargar el catalogo de tareas.");
  }

  if (catalogGroupsError) {
    throw new Error("No pudimos cargar los grupos del catalogo.");
  }

  if (catalogGroupCategoriesError) {
    throw new Error("No pudimos cargar las categorias de grupos del catalogo.");
  }

  if (catalogGroupCategoryLinksError) {
    throw new Error("No pudimos cargar la relacion entre grupos y categorias del catalogo.");
  }

  if (catalogGroupMembershipsError) {
    throw new Error("No pudimos cargar la relacion entre grupos y tareas.");
  }

  const subitemRecords = (subitemRows ?? []) as Tables<"onboarding_initiative_subitems">[];
  const logRecords = (logRows ?? []) as Tables<"onboarding_activity_logs">[];

  const initiatives = initiativeRecords.map((initiative) =>
    mapInitiative(
      initiative,
      subitemRecords.filter((subitem) => subitem.initiative_id === initiative.id),
      logRecords.filter((log) => log.initiative_id === initiative.id),
    ),
  );

  const visibleCatalogGroupRows = ((catalogGroupRows ?? []) as Tables<"credit_catalog_groups">[]).filter(
    (group) => canViewPrivateCatalog || group.is_public,
  );
  const visibleCatalogGroupIds = new Set(visibleCatalogGroupRows.map((group) => group.id));
  const visibleCatalogGroupCategoryLinkRows = (
    (catalogGroupCategoryLinkRows ?? []) as Tables<"credit_catalog_group_category_links">[]
  ).filter((link) => visibleCatalogGroupIds.has(link.group_id));
  const visibleCatalogGroupMembershipRows = (
    (catalogGroupMembershipRows ?? []) as Tables<"credit_catalog_group_items">[]
  ).filter((membership) => visibleCatalogGroupIds.has(membership.group_id));

  let members: ClientMemberRecord[] = [];
  let shareLinks: ShareLinkRecord[] = [];

  if (accessRole === "owner") {
    const [{ data: memberRows }, { data: profileRows }, { data: shareLinkRows }] = await Promise.all([
      supabase.from("client_members").select("*").eq("client_id", clientRecord.id),
      supabase.from("profiles").select("id, email, full_name"),
      supabase
        .from("client_share_links")
        .select("*")
        .eq("client_id", clientRecord.id)
        .order("created_at", { ascending: false }),
    ]);

    const memberRecords = (memberRows ?? []) as Array<{
      client_id: string;
      user_id: string;
      access_role: "viewer" | "editor" | "owner";
      profile_role: "sales" | "csm" | "client" | "stakeholder";
      added_by_user_id: string | null;
      accepted_at: string;
      created_at: string;
      updated_at: string;
    }>;
    const profileRecords = (profileRows ?? []) as Array<{
      id: string;
      email: string;
      full_name: string | null;
    }>;

    const profileMap = new Map(profileRecords.map((profile) => [profile.id, profile]));

    members = memberRecords.map((member) => ({
      ...member,
      email: profileMap.get(member.user_id)?.email ?? null,
      full_name: profileMap.get(member.user_id)?.full_name ?? null,
    }));
    shareLinks = (shareLinkRows ?? []) as ShareLinkRecord[];
  }

  const requestedStage = resolvedSearchParams?.stage as ProjectStage | undefined;
  const configRecord = (configRow as Tables<"onboarding_configs"> | null) ?? createDefaultConfig(clientRecord.id);
  const initialStage =
    requestedStage ??
    (membershipProfileRole ? resolveStageFromProfileRole(membershipProfileRole) : undefined) ??
    ((configRecord.current_stage as ProjectStage | undefined) ?? "cs");
  const billingStatusArgs: Database["public"]["Functions"]["get_client_billing_status"]["Args"] = {
    p_client_id: clientRecord.id,
  };
  const { data: billingRow } = (await clientReader.rpc(
    "get_client_billing_status" as never,
    billingStatusArgs as never,
  )) as {
    data: ClientBillingStatus | null;
    error: Error | null;
  };

  return (
    <OnboardingClientPage
      initialData={{
        client: {
          ...clientRecord,
          access_role: accessRole,
        },
        accessRole,
        config: configRecord,
        billing: billingRow ?? createDefaultBillingStatus(configRecord),
        initiatives,
        catalog: catalogRows ?? [],
        catalogGroups: visibleCatalogGroupRows,
        catalogGroupCategories: catalogGroupCategoryRows ?? [],
        catalogGroupCategoryLinks: visibleCatalogGroupCategoryLinkRows,
        catalogGroupMemberships: visibleCatalogGroupMembershipRows,
        shareLinks,
        members,
        northStarHistory: northStarHistoryRows ?? [],
      }}
      initialStage={initialStage}
      userId={user.id}
      canSharePublicLinks={accessRole === "owner" || platformRole === "superadmin"}
    />
  );
}
