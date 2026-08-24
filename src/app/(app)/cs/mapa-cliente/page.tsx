import { redirect } from "next/navigation";

import { ClientUseCaseMap } from "@/components/cs/client-use-case-map";
import { requireUser } from "@/lib/auth";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCluster,
  CreditCatalogGroupClusterLink,
  CreditCatalogUseCaseCategory,
} from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientUseCaseMapPage() {
  const { platformProfile } = await requireUser("/cs/mapa-cliente");
  const platformRole = platformProfile?.platform_role ?? null;

  if (platformRole !== "admin" && platformRole !== "superadmin" && platformRole !== "csm") {
    redirect("/dashboard");
  }

  const admin = createSupabaseAdminClient();

  const [
    { data: clientRows, error: clientsError },
    { data: groupRows, error: groupsError },
    { data: clusterRows, error: clustersError },
    { data: clusterLinkRows, error: clusterLinksError },
    { data: categoryRows, error: categoriesError },
    { data: progressRows, error: progressError },
  ] = await Promise.all([
    admin
      .from("clients")
      .select("id,name,slug,is_active")
      .order("is_active", { ascending: false })
      .order("name"),
    admin.from("credit_catalog_groups").select("*").order("sort_order").order("name"),
    admin.from("credit_catalog_group_clusters").select("*").order("sort_order").order("label"),
    admin
      .from("credit_catalog_group_cluster_links")
      .select("*")
      .order("group_id")
      .order("sort_order"),
    admin.from("credit_catalog_use_case_categories").select("*").order("name"),
    admin.from("client_use_case_progress").select("id,client_id,group_id,is_completed,completed_at"),
  ]);

  if (clientsError) throw new Error("No pudimos cargar los clientes.");
  if (groupsError) throw new Error("No pudimos cargar los casos de uso.");
  if (clustersError) throw new Error("No pudimos cargar los clústeres.");
  if (clusterLinksError) throw new Error("No pudimos cargar la relación con los clústeres.");
  if (categoriesError) throw new Error("No pudimos cargar las categorías de casos de uso.");
  if (progressError) throw new Error("No pudimos cargar el progreso de los clientes.");

  return (
    <ClientUseCaseMap
      clients={(clientRows ?? []) as Pick<Tables<"clients">, "id" | "name" | "slug" | "is_active">[]}
      groups={(groupRows ?? []) as CreditCatalogGroup[]}
      clusters={(clusterRows ?? []) as CreditCatalogGroupCluster[]}
      clusterLinks={(clusterLinkRows ?? []) as CreditCatalogGroupClusterLink[]}
      categories={(categoryRows ?? []) as CreditCatalogUseCaseCategory[]}
      progress={(progressRows ?? []) as Tables<"client_use_case_progress">[]}
    />
  );
}
