import { NextResponse } from "next/server";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import { generateSalesProposalSlug, normalizeSalesProposalDraft } from "@/lib/sales-proposals";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    let body = normalizeSalesProposalDraft(await request.json());

    if (body.workspaceVariant === "dinterweb") {
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
      body = {
        ...body,
        sellerName: seller.name,
        sellerEmail: seller.email,
        sellerCompany: seller.company,
      };
    }

    const slug = body.slug || generateSalesProposalSlug(body);
    const proposal = await saveSalesProposal(body, slug);

    return NextResponse.json(proposal);
  } catch (caughtError) {
    return NextResponse.json(
      {
        message: formatUserError(
          caughtError,
          "No pudimos crear la propuesta comercial en este momento.",
        ),
      },
      { status: 400 },
    );
  }
}
