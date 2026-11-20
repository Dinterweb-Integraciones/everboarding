import { NextResponse } from "next/server";

import { isAllowedDinterwebUser } from "@/lib/auth-domain";
import { getDinterwebSellerIdentity } from "@/lib/dinterweb-sellers";
import {
  applySalesCommercialWaiverPolicy,
  generateSalesProposalSlug,
  normalizeSalesProposalDraft,
} from "@/lib/sales-proposals";
import { resolveTrustedProposalPriceList } from "@/lib/price-lists-server";
import { getSalesProposalBySlug, getSalesProposalMutationAccess } from "@/lib/sales-proposal-access";
import { saveSalesProposal } from "@/lib/sales-proposals-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUserError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    let body = normalizeSalesProposalDraft(await request.json());
    let isSuperadmin = false;

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
      const admin = createSupabaseAdminClient();
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("platform_role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      const typedProfile = profile as { platform_role: string | null } | null;
      isSuperadmin = typedProfile?.platform_role === "superadmin";
      body = {
        ...body,
        sellerName: seller.name,
        sellerEmail: seller.email,
        sellerCompany: seller.company,
      };
    }

    body = applySalesCommercialWaiverPolicy(body, { isSuperadmin });

    // El board reenvía a esta ruta el slug de una propuesta recién creada cuando dos autoguardados se
    // cruzan: en ese caso se actualiza la misma propuesta, como siempre. Pero esta ruta no pide sesión
    // para HubSpot, así que solo se actualiza si quien llama tiene permiso sobre la propuesta existente
    // (el mismo chequeo del PUT). Si no lo tiene, se crea una propuesta nueva con otro slug.
    const requestedSlug = body.slug?.trim() || "";
    const existingProposal = requestedSlug ? await getSalesProposalBySlug(requestedSlug) : null;

    if (existingProposal) {
      const proposalAccess = await getSalesProposalMutationAccess(requestedSlug);

      if (proposalAccess.ok) {
        const proposal = await saveSalesProposal(
          {
            ...body,
            priceList: await resolveTrustedProposalPriceList(body.priceList, proposalAccess.proposal.priceList),
          },
          requestedSlug,
        );

        return NextResponse.json(proposal);
      }
    }

    body = {
      ...body,
      priceList: await resolveTrustedProposalPriceList(body.priceList, null),
      // Una propuesta nueva nace en borrador: el pago y la activación los marcan sus propios flujos.
      status: "draft",
      activatedClientId: null,
      transferValidatedAt: null,
      transferValidatedByUserId: null,
    };

    let slug = existingProposal ? generateSalesProposalSlug(body) : requestedSlug || generateSalesProposalSlug(body);
    while (await getSalesProposalBySlug(slug)) {
      slug = generateSalesProposalSlug(body);
    }

    const proposal = await saveSalesProposal({ ...body, id: undefined, slug }, slug);

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
