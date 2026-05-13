import { NextResponse } from "next/server";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { mapSalesProposalRow, normalizeSalesProposalDraft } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";
import type { Database } from "@/types/database";

type SalesProposalRouteProps = {
  params: Promise<{ slug: string }>;
};

type SalesProposalRow = Database["public"]["Tables"]["sales_proposals"]["Row"];

export async function PUT(request: Request, { params }: SalesProposalRouteProps) {
  try {
    const { slug } = await params;
    let body = normalizeSalesProposalDraft(await request.json());
    const admin = createSupabaseAdminClient();
    const { data: proposalRow } = await admin
      .from("sales_proposals")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    const existingProposal = proposalRow ? mapSalesProposalRow(proposalRow as SalesProposalRow) : null;
    const isDinterwebProposal =
      body.workspaceVariant === "dinterweb" || existingProposal?.workspaceVariant === "dinterweb";

    if (isDinterwebProposal) {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !isAllowedDinterwebUser(user)) {
        return NextResponse.json(
          { message: "Necesitas iniciar sesion con tu correo de Dinterweb." },
          { status: 401 },
        );
      }

      const seller = getDinterwebSellerIdentity(user);

      if (
        existingProposal &&
        existingProposal.sellerEmail.trim().toLowerCase() &&
        existingProposal.sellerEmail.trim().toLowerCase() !== seller.email
      ) {
        return NextResponse.json(
          { message: "Esta propuesta pertenece a otro vendedor de Dinterweb." },
          { status: 403 },
        );
      }

      body = {
        ...body,
        workspaceVariant: "dinterweb",
        sellerName: seller.name,
        sellerEmail: seller.email,
        sellerCompany: seller.company,
      };
    }

    const proposal = await saveSalesProposal(body, slug);

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos actualizar la propuesta comercial.",
        ),
      },
      { status: 400 },
    );
  }
}
