import { NextResponse } from "next/server";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { getSalesProposalMutationAccess } from "@/lib/sales-proposal-access";
import { normalizeSalesProposalDraft } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";

type SalesProposalRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function PUT(request: Request, { params }: SalesProposalRouteProps) {
  try {
    const { slug } = await params;
    let body = normalizeSalesProposalDraft(await request.json());
    const proposalAccess = await getSalesProposalMutationAccess(slug);

    if (!proposalAccess.ok) {
      return NextResponse.json({ message: proposalAccess.message }, { status: proposalAccess.status });
    }

    const existingProposal = proposalAccess.proposal;
    const isDinterwebProposal = existingProposal.workspaceVariant === "dinterweb";

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
