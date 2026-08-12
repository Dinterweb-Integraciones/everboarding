import { UseCaseClusterGraph } from "@/components/cs/use-case-cluster-graph";
import { requireUser } from "@/lib/auth";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCluster,
  CreditCatalogGroupClusterLink,
  CreditCatalogUseCaseCategory,
} from "@/lib/onboarding";

export default async function UseCaseClusterMapPage() {
  const { supabase } = await requireUser();

  const [
    { data: groupRows, error: groupsError },
    { data: clusterRows, error: clustersError },
    { data: clusterLinkRows, error: clusterLinksError },
    { data: categoryRows, error: categoriesError },
  ] = await Promise.all([
    supabase.from("credit_catalog_groups").select("*").order("sort_order").order("name"),
    supabase.from("credit_catalog_group_clusters").select("*").order("sort_order").order("label"),
    supabase
      .from("credit_catalog_group_cluster_links")
      .select("*")
      .order("group_id")
      .order("sort_order"),
    supabase.from("credit_catalog_use_case_categories").select("*").order("name"),
  ]);

  if (groupsError) throw new Error("No pudimos cargar los casos de uso.");
  if (clustersError) throw new Error("No pudimos cargar los clústeres.");
  if (clusterLinksError) throw new Error("No pudimos cargar la relación con los clústeres.");
  if (categoriesError) throw new Error("No pudimos cargar las categorías de casos de uso.");

  return (
    <UseCaseClusterGraph
      groups={(groupRows ?? []) as CreditCatalogGroup[]}
      clusters={(clusterRows ?? []) as CreditCatalogGroupCluster[]}
      clusterLinks={(clusterLinkRows ?? []) as CreditCatalogGroupClusterLink[]}
      categories={(categoryRows ?? []) as CreditCatalogUseCaseCategory[]}
    />
  );
}
