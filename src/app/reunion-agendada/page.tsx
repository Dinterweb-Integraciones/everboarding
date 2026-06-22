import type { Metadata } from "next";
import Script from "next/script";
import { CalendarCheck2 } from "lucide-react";

import { MeetingLandingFrameEscape } from "@/components/onboarding/meeting-landing-frame-escape";

export const metadata: Metadata = {
  title: "Reunión agendada",
  description: "Tu reunión ha quedado agendada.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function MeetingScheduledPage() {
  return (
    <main className="min-h-screen bg-[#f5f8fa] px-5 py-10 text-[#001d3d] sm:px-8 sm:py-16">
      <MeetingLandingFrameEscape />
      <Script
        src="https://play.vidyard.com/embed/v4.js"
        strategy="afterInteractive"
      />

      <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <div className="px-6 pb-5 pt-8 text-center sm:px-12 sm:pb-8 sm:pt-12">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e6fffb] text-[#00a48f]">
            <CalendarCheck2 className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#516f90]">
            Confirmado
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Tu reunión ya está agendada
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#516f90]">
            Te enviamos la confirmación con todos los detalles. Mientras llega el
            momento, mira este video para prepararte.
          </p>
        </div>

        <div className="border-t border-slate-100 bg-slate-50 p-3 sm:p-6">
          {/* Vidyard requiere una imagen nativa con estos atributos para montar el reproductor. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="vidyard-player-embed block w-full"
            src="https://play.vidyard.com/y92AEHdWcoJHTptob8jyei.jpg"
            data-uuid="y92AEHdWcoJHTptob8jyei"
            data-v="4"
            data-type="inline"
            alt="Video de preparación para tu reunión"
          />
        </div>
      </section>
    </main>
  );
}
