import { CalendarCheck2 } from "lucide-react";
import { notFound } from "next/navigation";

import { BrandLogo } from "@/components/layout/brand-logo";
import { ScheduleLaterForm } from "@/components/onboarding/schedule-later-form";
import { getSalesProposalBySlug } from "@/lib/public-prospect";
import type { PublicOnboardingAudience } from "@/lib/onboarding";

const KICKOFF_MEETING_URL =
  "https://meetings.hubspot.com/xrivera/kick-off2?uuid=41b16e6c-b098-4e4d-a05e-0f611e7d800c";

type ScheduleKickoffPageProps = {
  params: Promise<{
    audience: string;
    slug: string;
  }>;
  searchParams?: Promise<{
    payment?: string;
    session_id?: string;
  }>;
};

function isPublicAudience(value: string): value is PublicOnboardingAudience {
  return value === "client" || value === "prospect";
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ScheduleKickoffPage({
  params,
  searchParams,
}: ScheduleKickoffPageProps) {
  const { audience, slug } = await params;
  await searchParams;

  if (!isPublicAudience(audience) || audience !== "prospect") {
    notFound();
  }

  const proposal = await getSalesProposalBySlug(slug);

  if (!proposal) {
    notFound();
  }

  const publicProposalUrl = `/public/${audience}/${slug}`;
  const contactEmail = proposal.clientEmail || "";

  return (
    <main className="min-h-screen bg-[#f5f8fa] text-[#001d3d]">
      <header className="border-b border-slate-200 bg-white px-5 py-3 sm:px-8">
        <BrandLogo href={publicProposalUrl} priority />
      </header>

      <section className="mx-auto w-full max-w-7xl px-5 py-8 lg:px-8">
        <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="border-b border-slate-100 px-6 py-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#e6fffb] text-[#00a48f]">
                <CalendarCheck2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#516f90]">
                  Siguiente paso
                </p>
                <h1 className="mt-2 text-3xl font-black leading-tight text-[#001d3d]">
                  Agenda tu kickoff
                </h1>
              </div>
            </div>
          </div>

          <div className="min-h-[760px]">
            <iframe
              title="Agenda kickoff"
              src={KICKOFF_MEETING_URL}
              className="h-[760px] w-full border-0"
              loading="eager"
            />
          </div>

          <div className="border-t border-slate-100 px-6 py-6">
            <ScheduleLaterForm
              defaultEmail={contactEmail}
              audience={audience}
              publicSlug={slug}
              publicProposalUrl={publicProposalUrl}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
