import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { canAccessAdminCatalogs } from "@/lib/platform-access";
import { formatUserError } from "@/lib/utils";

type ClusterRouteProps = {
  params: Promise<{ clusterId: string }>;
};

export async function DELETE(_: Request, { params }: ClusterRouteProps) {
  try {
    const { clusterId } = await params;
    const { supabase, platformProfile } = await requireUser();
    if (!canAccessAdminCatalogs(platformProfile?.platform_role)) {
      return NextResponse.json(
        { message: "No tienes permisos para administrar clusters." },
        { status: 403 },
      );
    }

    const { data: cluster, error: clusterError } = await supabase
      .from("credit_catalog_group_clusters")
      .select("id")
      .eq("id", clusterId)
      .maybeSingle();

    if (clusterError) throw clusterError;
    if (!cluster) {
      return NextResponse.json({ message: "El cluster ya no existe." }, { status: 404 });
    }

    const { data: usageRows, error: usageError } = await supabase
      .from("credit_catalog_group_cluster_links")
      .select("id")
      .eq("cluster_id", clusterId)
      .limit(1);

    if (usageError) throw usageError;
    if ((usageRows ?? []).length > 0) {
      const { data, error: archiveError } = await supabase
        .from("credit_catalog_group_clusters")
        .update({ is_active: false })
        .eq("id", clusterId)
        .select("*")
        .single();

      if (archiveError) throw archiveError;
      return NextResponse.json({ success: true, disposition: "archived", cluster: data });
    }

    const { error } = await supabase
      .from("credit_catalog_group_clusters")
      .delete()
      .eq("id", clusterId);

    if (error) throw error;
    return NextResponse.json({ success: true, disposition: "deleted" });
  } catch (caughtError) {
    return NextResponse.json(
      { message: formatUserError(caughtError, "No pudimos eliminar el cluster.") },
      { status: 400 },
    );
  }
}
