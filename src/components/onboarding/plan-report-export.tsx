import { Lexend_Deca, Questrial } from "next/font/google";
import { useMemo, type CSSProperties } from "react";

import type { InitiativeStatus } from "@/lib/onboarding";

const questrial = Questrial({ subsets: ["latin"], weight: "400", variable: "--font-questrial" });
const lexendDeca = Lexend_Deca({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-lexend-deca",
});

export type PlanReportSubitem = {
  id: string;
  name: string;
  quantity: number;
  unitCredits: number;
  statusLabel?: string;
};

export type PlanReportInitiative = {
  id: string;
  title: string;
  description: string;
  successMilestone?: string;
  completionOutcome?: string;
  credits: number;
  status: InitiativeStatus;
  dateRange: string;
  estStartDate?: string | null;
  estEndDate?: string | null;
  isBlocked?: boolean;
  subitems: PlanReportSubitem[];
};

export type PlanReportMetrics = {
  available: number;
  committed: number;
  completed: number;
  lost?: number;
  total: number;
  priceLabel: string;
  creditsLabel: string;
  cadenceLabel: string;
};

type PlanReportExportPagesProps = {
  rootId: string;
  pageIdPrefix: string;
  clientName: string;
  startDateLabel: string;
  metrics: PlanReportMetrics;
  groupedInitiatives: Record<InitiativeStatus, PlanReportInitiative[]>;
  publicPath?: string;
  proposalCode?: string;
  preparedByLabel?: string;
  isRecurringPlan?: boolean;
};

// ---------------------------------------------------------------------------
// Dinterweb print-proposal design tokens — matches the reference template
// (propuesta-comercial-standalone.html) 1:1.
// ---------------------------------------------------------------------------
const C = {
  red: "#FF0D1D",
  red600: "#E50A18",
  red050: "#FFF5F6",
  n950: "#0B0F17",
  n900: "#131826",
  n700: "#333B4F",
  n500: "#6B7588",
  n400: "#98A0B0",
  n300: "#C8CCD6",
  n200: "#E3E6EC",
  n150: "#ECEFF3",
  n100: "#F4F6F9",
  n050: "#FAFBFD",
};

const FONT_BODY = "var(--font-questrial), var(--font-lexend-deca), sans-serif";
const FONT_ALT = "var(--font-lexend-deca), sans-serif";

// Matches metadataBase in src/app/layout.tsx — kept as a fixed constant (rather
// than window.location.origin) so the server-rendered markup and the first
// client render are byte-identical and never trip a hydration mismatch.
const PUBLIC_APP_ORIGIN = "https://app.dinterweb.com";

const PROPOSAL_VALIDITY_LABEL = "30 dias";
const WARRANTY_DAYS_LABEL = "30 dias";
const WARRANTY_TITLE = `${WARRANTY_DAYS_LABEL} por cada caso de uso`;

// 96dpi conversion of the reference template's inch-based margins.
const IN = 96;
const PAGE_MARGIN = 0.7 * IN; // 67.2px page margin on every side
const PAGE_WIDTH = 8.5 * IN; // 816px
const PAGE_HEIGHT = 11 * IN; // 1056px

function pageStyle(extraTopIn = 0): CSSProperties {
  return {
    width: PAGE_WIDTH,
    minHeight: PAGE_HEIGHT,
    boxSizing: "border-box",
    background: "#FFFFFF",
    color: C.n700,
    fontFamily: FONT_BODY,
    paddingTop: PAGE_MARGIN + extraTopIn * IN,
    paddingRight: PAGE_MARGIN,
    paddingBottom: PAGE_MARGIN,
    paddingLeft: PAGE_MARGIN,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  };
}

const reportStatuses: InitiativeStatus[] = ["executing", "planned", "backlog", "completed"];

const STAGE_LABELS: Record<InitiativeStatus, string> = {
  executing: "Kickoff · en ejecucion",
  planned: "Planificado",
  backlog: "En evaluacion",
  completed: "Completado",
};

function chunkItems<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function hasUnsupportedColorFunction(value: string) {
  return /\b(?:oklch|oklab|lab|lch)\(/i.test(value);
}

function sanitizeExportColors(root: HTMLElement) {
  const colorFallbacks: Array<[string, string, string]> = [
    ["color", "color", "#33475b"],
    ["backgroundColor", "background-color", "transparent"],
    ["borderTopColor", "border-top-color", "#dfe3eb"],
    ["borderRightColor", "border-right-color", "#dfe3eb"],
    ["borderBottomColor", "border-bottom-color", "#dfe3eb"],
    ["borderLeftColor", "border-left-color", "#dfe3eb"],
    ["textDecorationColor", "text-decoration-color", "#33475b"],
    ["outlineColor", "outline-color", "#dfe3eb"],
    ["caretColor", "caret-color", "#33475b"],
    ["fill", "fill", "#33475b"],
    ["stroke", "stroke", "#33475b"],
  ];

  const styleLookup = {
    color: (styles: CSSStyleDeclaration) => styles.color,
    backgroundColor: (styles: CSSStyleDeclaration) => styles.backgroundColor,
    borderTopColor: (styles: CSSStyleDeclaration) => styles.borderTopColor,
    borderRightColor: (styles: CSSStyleDeclaration) => styles.borderRightColor,
    borderBottomColor: (styles: CSSStyleDeclaration) => styles.borderBottomColor,
    borderLeftColor: (styles: CSSStyleDeclaration) => styles.borderLeftColor,
    textDecorationColor: (styles: CSSStyleDeclaration) => styles.textDecorationColor,
    outlineColor: (styles: CSSStyleDeclaration) => styles.outlineColor,
    caretColor: (styles: CSSStyleDeclaration) => styles.caretColor,
    fill: (styles: CSSStyleDeclaration) => styles.fill,
    stroke: (styles: CSSStyleDeclaration) => styles.stroke,
  } as const;

  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  nodes.forEach((node) => {
    const styles = window.getComputedStyle(node);

    colorFallbacks.forEach(([propertyName, cssName, fallback]) => {
      const value = styleLookup[propertyName as keyof typeof styleLookup](styles);
      if (hasUnsupportedColorFunction(value)) {
        node.style.setProperty(cssName, fallback);
      }
    });
  });
}

export async function exportPlanReportPdf(rootId: string, filename: string) {
  const reportRoot = document.getElementById(rootId);
  if (!reportRoot) {
    throw new Error("No se encontro el reporte para exportar.");
  }

  const pages = Array.from(
    reportRoot.querySelectorAll<HTMLElement>('[data-report-page="true"]'),
  );
  if (!pages.length) {
    throw new Error("No hay paginas disponibles para exportar.");
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  // html2canvas snapshots whatever is painted at call time — if the brand
  // webfonts (Questrial / Lexend Deca) are still downloading, it silently
  // falls back to the system font. Waiting for document.fonts.ready avoids
  // that race so the export always matches the on-screen typography.
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  for (const [index, page] of pages.entries()) {
    const canvas = await html2canvas(page, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      onclone: (clonedDocument) => {
        const clonedPage = clonedDocument.getElementById(page.id);
        if (clonedPage instanceof HTMLElement) {
          sanitizeExportColors(clonedPage);
        } else if (clonedDocument.body) {
          sanitizeExportColors(clonedDocument.body);
        }
      },
    });

    const imageData = canvas.toDataURL("image/png");
    const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
    const renderWidth = canvas.width * ratio;
    const renderHeight = canvas.height * ratio;
    const offsetX = (pdfWidth - renderWidth) / 2;
    const offsetY = (pdfHeight - renderHeight) / 2;

    if (index > 0) {
      pdf.addPage();
    }

    pdf.addImage(imageData, "PNG", offsetX, offsetY, renderWidth, renderHeight);

    // The page itself is a flat raster image — any <a href> inside it is
    // otherwise inert. Overlay a real clickable PDF link annotation at the
    // same spot so buttons like "Ver plan de trabajo en linea" still work.
    const pageRect = page.getBoundingClientRect();
    const mmPerPx = pageRect.width > 0 ? renderWidth / pageRect.width : 0;
    if (mmPerPx > 0) {
      const linkEls = Array.from(page.querySelectorAll<HTMLElement>('[data-pdf-link="true"]'));
      for (const linkEl of linkEls) {
        const href = linkEl.getAttribute("href");
        if (!href) continue;
        const elRect = linkEl.getBoundingClientRect();
        pdf.link(
          offsetX + (elRect.left - pageRect.left) * mmPerPx,
          offsetY + (elRect.top - pageRect.top) * mmPerPx,
          elRect.width * mmPerPx,
          elRect.height * mmPerPx,
          { url: href },
        );
      }
    }
  }

  pdf.save(filename);
}

// ---------------------------------------------------------------------------
// Shared visual atoms
// ---------------------------------------------------------------------------
function SectionHeading({ eyebrow, title, marginBottom = 26 }: { eyebrow: string; title?: string; marginBottom?: number }) {
  return (
    <div style={{ marginBottom }}>
      <h2
        style={{
          fontFamily: FONT_ALT,
          fontWeight: 700,
          fontSize: 40,
          lineHeight: 1,
          letterSpacing: "-0.035em",
          color: C.n950,
          margin: "0 0 4px",
        }}
      >
        {eyebrow}
      </h2>
      {title ? (
        <p
          style={{
            fontSize: 32,
            lineHeight: 1.1,
            letterSpacing: "-0.025em",
            color: C.n950,
            margin: "0 0 18px",
            maxWidth: "16em",
          }}
        >
          {title}
          <span style={{ color: C.red }}>.</span>
        </p>
      ) : null}
      <div style={{ width: 64, height: 4, borderRadius: 999, background: C.red, margin: title ? 0 : "16px 0 24px" }} />
    </div>
  );
}

function FieldLabel({ children, tone = C.n500 }: { children: React.ReactNode; tone?: string }) {
  return (
    <p
      style={{
        fontFamily: FONT_ALT,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: tone,
        margin: "0 0 8px",
      }}
    >
      {children}
    </p>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block", flex: "0 0 auto" }}>
      <path
        d="M12 2.75 4.75 5.6v6.05c0 4.35 3.02 7.9 7.25 9.6 4.23-1.7 7.25-5.25 7.25-9.6V5.6L12 2.75Z"
        stroke={C.red}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.9 11.9l2.15 2.15 4.05-4.05" stroke={C.red} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getBreakdownCreditsLabel(initiative: PlanReportInitiative) {
  return `${initiative.status === "backlog" ? "≈ " : ""}${initiative.credits} creditos`;
}

// ---------------------------------------------------------------------------
// Timeline (week-grid Gantt) computation for the "Plan de trabajo" page
// ---------------------------------------------------------------------------
function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildTimelineRows(groupedInitiatives: Record<InitiativeStatus, PlanReportInitiative[]>) {
  const relevant: Array<{ initiative: PlanReportInitiative; start: Date; end: Date }> = [];

  (["executing", "planned", "backlog"] as InitiativeStatus[]).forEach((status) => {
    (groupedInitiatives[status] ?? []).forEach((initiative) => {
      const rawStart = parseIsoDate(initiative.estStartDate);
      const rawEnd = parseIsoDate(initiative.estEndDate) ?? rawStart;
      if (!rawStart || !rawEnd) return;
      relevant.push({
        initiative,
        start: rawStart <= rawEnd ? rawStart : rawEnd,
        end: rawEnd >= rawStart ? rawEnd : rawStart,
      });
    });
  });

  if (!relevant.length) return null;

  relevant.sort((a, b) => a.start.getTime() - b.start.getTime());

  const windowStart = relevant.reduce((min, row) => (row.start < min ? row.start : min), relevant[0].start);
  const windowEnd = relevant.reduce((max, row) => (row.end > max ? row.end : max), relevant[0].end);
  const totalDays = Math.max(
    Math.round((windowEnd.getTime() - windowStart.getTime()) / 86_400_000) + 1,
    7,
  );
  // Not capped — a long project just gets a wider week axis. Bars are placed
  // by continuous day-based percentages (not snapped to a fixed column
  // count), which also sidesteps html2canvas's shaky support for CSS Grid
  // item placement (grid-column spans render reliably in a live browser but
  // can collapse/misplace when captured for the PDF export).
  const totalWeeks = Math.max(Math.ceil(totalDays / 7), 1);

  // Cap the number of labeled ticks on the week axis so a long project
  // doesn't cram dozens of illegible numbers into one row.
  const tickStep = Math.max(1, Math.ceil(totalWeeks / 12));
  const ticks: number[] = [];
  for (let week = 1; week <= totalWeeks; week += tickStep) {
    ticks.push(week);
  }
  if (ticks[ticks.length - 1] !== totalWeeks) {
    ticks.push(totalWeeks);
  }

  const rows = relevant.map(({ initiative, start, end }) => {
    const offsetDays = Math.round((start.getTime() - windowStart.getTime()) / 86_400_000);
    const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    return {
      initiative,
      leftPercent: (offsetDays / totalDays) * 100,
      widthPercent: Math.max((spanDays / totalDays) * 100, 1.5),
    };
  });

  return { rows, totalWeeks, ticks };
}

const TIMELINE_LABEL_WIDTH = 196.8; // 2.05in @ 96dpi, matches the reference template's label column
const TIMELINE_ROWS_PER_PAGE = 14;

export function PlanReportExportPages({
  rootId,
  pageIdPrefix,
  clientName,
  startDateLabel,
  metrics,
  groupedInitiatives,
  publicPath,
  proposalCode,
  preparedByLabel,
  isRecurringPlan = false,
}: PlanReportExportPagesProps) {
  const timeline = useMemo(() => buildTimelineRows(groupedInitiatives), [groupedInitiatives]);
  const breakdownGroups = reportStatuses
    .map((status) => ({ status, items: groupedInitiatives[status] ?? [] }))
    .filter((group) => group.items.length > 0);
  const totalBreakdownCredits = breakdownGroups.reduce(
    (sum, group) => sum + group.items.reduce((groupSum, item) => groupSum + item.credits, 0),
    0,
  );
  const lastGroupIndex = breakdownGroups.length - 1;
  const publicUrl = publicPath ? `${PUBLIC_APP_ORIGIN}${publicPath}` : undefined;

  return (
    <div
      id={rootId}
      className={`pointer-events-none fixed left-[-300vw] top-0 z-[-1] ${questrial.variable} ${lexendDeca.variable}`}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Page 1 — Portada                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div
        id={`${pageIdPrefix}-cover`}
        data-report-page="true"
        style={{
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          boxSizing: "border-box",
          background: "#FFFFFF",
          fontFamily: FONT_BODY,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: PAGE_WIDTH,
            height: 10.3 * IN,
            background:
              "radial-gradient(circle at 6% 4%, rgba(255,157,110,0.16), transparent 24%)," +
              "radial-gradient(circle at 97% 45%, rgba(255,157,110,0.16), transparent 26%)," +
              "radial-gradient(circle at 18% 96%, rgba(255,157,110,0.14), transparent 26%)",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            boxSizing: "border-box",
            paddingTop: PAGE_MARGIN + 0.15 * IN,
            paddingRight: PAGE_MARGIN + 0.1 * IN,
            paddingBottom: PAGE_MARGIN,
            paddingLeft: PAGE_MARGIN + 0.1 * IN,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 22, marginBottom: 88 }}>
            <img src="/proposal/hubspot-logo.png" alt="HubSpot" style={{ height: 32, width: "auto", display: "block" }} />
            <span style={{ width: 1, height: 34, background: C.n300 }} />
            <img src="/proposal/dinterweb-logo.png" alt="dinterweb" style={{ height: 34, width: "auto", display: "block" }} />
          </div>

          <h1
            style={{
              fontFamily: FONT_ALT,
              fontWeight: 700,
              fontSize: 62,
              lineHeight: 0.98,
              letterSpacing: "-0.035em",
              color: C.n950,
              margin: "0 0 22px",
              maxWidth: "12em",
            }}
          >
            Que tu empresa opere con la solidez que hace crecer a tu gente.
          </h1>

          <p style={{ fontSize: 30, lineHeight: 1.25, color: C.n900, margin: "0 0 26px" }}>Casos de uso en HubSpot</p>

          <div style={{ width: 210, height: 13, borderRadius: 999, background: C.red, margin: "0 0 26px" }} />

          <p style={{ fontSize: 32, lineHeight: 1.25, color: C.n950, margin: 0 }}>{clientName}</p>

          <div style={{ flex: 1 }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderTop: `1px solid ${C.n300}` }}>
            <div style={{ padding: "16px 16px 0 0" }}>
              <FieldLabel>Propuesta</FieldLabel>
              <p style={{ fontSize: 15, lineHeight: 1.3, color: C.n950, margin: 0 }}>{proposalCode || "—"}</p>
            </div>
            <div style={{ padding: "16px 16px 0 0" }}>
              <FieldLabel>Fecha</FieldLabel>
              <p style={{ fontSize: 15, lineHeight: 1.3, color: C.n950, margin: 0 }}>{startDateLabel}</p>
            </div>
            <div style={{ padding: "16px 16px 0 0" }}>
              <FieldLabel>Vigencia</FieldLabel>
              <p style={{ fontSize: 15, lineHeight: 1.3, color: C.n950, margin: 0 }}>{PROPOSAL_VALIDITY_LABEL}</p>
            </div>
            <div style={{ padding: "16px 0 0 0" }}>
              <FieldLabel>Preparada por</FieldLabel>
              <p style={{ fontSize: 15, lineHeight: 1.3, color: C.n950, margin: 0 }}>
                {preparedByLabel || "Equipo Dinterweb"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Page 2 — Resumen                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div id={`${pageIdPrefix}-summary`} data-report-page="true" style={pageStyle(0.34)}>
        <SectionHeading eyebrow="RESUMEN" marginBottom={0} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.35fr 1fr",
            border: `1px solid ${C.n200}`,
            borderRadius: 16,
            overflow: "hidden",
            margin: "22px 0 22px",
          }}
        >
          <div style={{ padding: "20px 24px", borderRight: `1px solid ${C.n200}` }}>
            <FieldLabel>Paquete de creditos</FieldLabel>
            <p style={{ fontFamily: FONT_ALT, fontWeight: 700, fontSize: 40, lineHeight: 1, letterSpacing: "-0.03em", color: C.n950, margin: 0 }}>
              {metrics.creditsLabel}
            </p>
          </div>
          <div style={{ padding: "22px 24px", background: C.red050, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <FieldLabel tone={C.red}>Inversion</FieldLabel>
            <p style={{ fontFamily: FONT_ALT, fontWeight: 700, fontSize: 40, lineHeight: 1, letterSpacing: "-0.03em", color: C.n950, margin: "0 0 8px" }}>
              {metrics.priceLabel}
            </p>
            <p style={{ fontSize: 12.5, lineHeight: 1.5, color: C.n700, margin: 0 }}>
              {isRecurringPlan
                ? `Cargo recurrente de forma ${metrics.cadenceLabel}.`
                : "Un solo pago contra activacion del servicio."}
            </p>
          </div>
        </div>

        <p
          style={{
            fontFamily: FONT_ALT,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.red,
            borderTop: `1px solid ${C.n200}`,
            paddingTop: 12,
            margin: "0 0 16px",
          }}
        >
          Casos de uso por etapa
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.75, color: C.n700, textAlign: "justify", margin: "0 0 4px" }}>
          El trabajo se organiza en casos de uso. Cada uno avanza por tres etapas:{" "}
          <span style={{ color: C.n950 }}>Kickoff</span>, donde alineamos objetivos y prioridades;{" "}
          <span style={{ color: C.n950 }}>Planificado</span>, lo que ya tiene alcance y criterio de exito
          definidos; y <span style={{ color: C.n950 }}>Evaluacion</span>, lo que se dimensionara durante la
          ejecucion con base en lo que la operacion revele.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            border: `1px solid ${C.n200}`,
            borderRadius: 16,
            marginTop: 20,
            padding: "18px 22px",
          }}
        >
          <span style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: "50%", background: C.red, marginTop: 6 }} />
          <p style={{ fontSize: 14, lineHeight: 1.65, color: C.n950, margin: 0 }}>
            Una vez activado el servicio, la sesion de{" "}
            <span style={{ color: C.red }}>Kickoff se agenda entre 3 y 7 dias</span>, segun la disponibilidad
            del equipo al momento de la activacion.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Page 3 — Plan de trabajo (paginates across multiple sheets when     */}
      {/* there are many initiatives, instead of shrinking to force-fit one) */}
      {/* ---------------------------------------------------------------- */}
      {(() => {
        const timelineChunks = timeline ? chunkItems(timeline.rows, TIMELINE_ROWS_PER_PAGE) : [[]];

        return timelineChunks.map((rowsChunk, chunkIndex) => {
          const isFirstPlanPage = chunkIndex === 0;
          const isLastPlanPage = chunkIndex === timelineChunks.length - 1;

          return (
            <div
              key={`${pageIdPrefix}-plan-${chunkIndex}`}
              id={`${pageIdPrefix}-plan-${chunkIndex}`}
              data-report-page="true"
              style={pageStyle(0.5)}
            >
              {isFirstPlanPage ? (
                <>
                  <SectionHeading eyebrow="PLAN DE TRABAJO" title="Como se distribuye la ejecucion" />
                  <p style={{ fontSize: 14, lineHeight: 1.75, color: C.n700, textAlign: "justify", margin: "0 0 24px" }}>
                    El cronograma es una proyeccion de referencia. Las fechas exactas se confirman en el
                    Kickoff, y los casos en evaluacion se incorporan al plan una vez que su alcance queda
                    definido.
                  </p>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <p style={{ fontFamily: FONT_ALT, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: C.red, margin: 0 }}>
                    PLAN DE TRABAJO (cont.)
                  </p>
                  <span style={{ flex: 1, height: 1, background: C.n200 }} />
                </div>
              )}

              {timeline ? (
                <div style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.n200}`, borderRadius: 16, padding: "20px 22px", marginBottom: 22 }}>
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      paddingBottom: 8,
                      borderBottom: `1px solid ${C.n200}`,
                    }}
                  >
                    <p style={{ fontFamily: FONT_ALT, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.n500, margin: 0, width: TIMELINE_LABEL_WIDTH, flex: "0 0 auto" }}>
                      Semana
                    </p>
                    <div style={{ position: "relative", flex: 1, height: 14 }}>
                      {timeline.ticks.map((week) => (
                        <span
                          key={`week-${week}`}
                          style={{
                            position: "absolute",
                            left: `${((week - 1) / timeline.totalWeeks) * 100}%`,
                            transform: week === timeline.totalWeeks ? "translateX(-100%)" : "translateX(-50%)",
                            fontFamily: FONT_ALT,
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: C.n500,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {week}
                        </span>
                      ))}
                    </div>
                  </div>

                  {rowsChunk.map(({ initiative, leftPercent, widthPercent }, index) => (
                    <div
                      key={initiative.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "14px 0",
                        borderBottom: index === rowsChunk.length - 1 ? "none" : `1px solid ${C.n150}`,
                      }}
                    >
                      <p
                        style={{
                          width: TIMELINE_LABEL_WIDTH,
                          flex: "0 0 auto",
                          fontSize: 12.5,
                          lineHeight: "17px",
                          color: initiative.status === "backlog" ? C.n700 : C.n950,
                          margin: 0,
                          paddingRight: 12,
                          overflowWrap: "break-word",
                        }}
                      >
                        {initiative.title}
                      </p>
                      <div style={{ position: "relative", flex: 1, height: 12 }}>
                        <div
                          style={{
                            position: "absolute",
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            height: 12,
                            borderRadius: 999,
                            boxSizing: "border-box",
                            background:
                              initiative.status === "backlog" ? C.n050 : initiative.status === "executing" ? C.red : C.red600,
                            border: initiative.status === "backlog" ? `1px dashed ${C.n400}` : "none",
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {isLastPlanPage ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 22, borderTop: `1px solid ${C.n200}`, paddingTop: 12, marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 22, height: 9, borderRadius: 999, background: C.red600 }} />
                        <p style={{ fontFamily: FONT_ALT, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: C.n500, margin: 0 }}>
                          Planificado
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 22, height: 9, borderRadius: 999, border: `1px dashed ${C.n400}`, boxSizing: "border-box" }} />
                        <p style={{ fontFamily: FONT_ALT, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: C.n500, margin: 0 }}>
                          En evaluacion
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  style={{
                    border: `1px dashed ${C.n300}`,
                    borderRadius: 16,
                    padding: "24px 20px",
                    textAlign: "center",
                    color: C.n500,
                    fontSize: 13,
                    marginBottom: 22,
                  }}
                >
                  Las fechas del cronograma se confirman durante el Kickoff.
                </div>
              )}

              {isLastPlanPage ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  <div style={{ border: `1px solid ${C.n200}`, borderRadius: 14, padding: "16px 18px" }}>
                    <FieldLabel>Ritmo de trabajo</FieldLabel>
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: C.n950, margin: 0 }}>
                      Sesiones de trabajo de acuerdo con lo requerido en cada caso de uso.
                    </p>
                  </div>
                  <div style={{ border: `1px solid ${C.n200}`, borderRadius: 14, padding: "16px 18px" }}>
                    <FieldLabel>Visibilidad</FieldLabel>
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: C.n950, margin: 0 }}>
                      Avance y consumo de creditos visibles en la plataforma, en todo momento.
                    </p>
                  </div>
                  <div style={{ border: `1px solid ${C.n200}`, borderRadius: 14, padding: "16px 18px" }}>
                    <FieldLabel>Cierre de caso</FieldLabel>
                    <p style={{ fontSize: 13, lineHeight: 1.5, color: C.n950, margin: 0 }}>
                      Un caso se cierra cuando su criterio de exito queda verificado con el cliente.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          );
        });
      })()}

      {/* ---------------------------------------------------------------- */}
      {/* Page 4 — Garantia                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div id={`${pageIdPrefix}-warranty`} data-report-page="true" style={pageStyle(0.38)}>
        <SectionHeading eyebrow="GARANTIA" title={WARRANTY_TITLE} marginBottom={22} />

        <div style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.n200}`, borderRadius: 16, padding: "20px 24px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
            <ShieldCheckIcon />
            <p style={{ fontSize: 15, lineHeight: 1.65, color: C.n950, margin: 0 }}>
              Cada caso de uso cuenta con{" "}
              <span style={{ color: C.red }}>{WARRANTY_DAYS_LABEL} de garantia de forma individual</span>,
              contados desde su activacion en la plataforma. La garantia no corre para el proyecto completo al
              final: corre caso por caso, a medida que cada proceso entra en operacion.
            </p>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: C.n700, textAlign: "justify", margin: "0 0 16px" }}>
            Eso permite revisar cada proceso de forma puntual y detallada, con el equipo usandolo en su dia a
            dia y con tiempo real para detectar ajustes, en lugar de dejar todas las observaciones para una
            revision final, cuando ya es mas costoso corregir.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, borderTop: `1px solid ${C.n150}`, paddingTop: 16 }}>
            <div>
              <FieldLabel>Cubre</FieldLabel>
              <p style={{ fontSize: 13, lineHeight: 1.55, color: C.n700, margin: 0 }}>
                Correccion de errores de configuracion en lo entregado
              </p>
            </div>
            <div>
              <FieldLabel>Cubre</FieldLabel>
              <p style={{ fontSize: 13, lineHeight: 1.55, color: C.n700, margin: 0 }}>
                Ajustes por comportamiento distinto al criterio de exito acordado
              </p>
            </div>
            <div>
              <FieldLabel>Cubre</FieldLabel>
              <p style={{ fontSize: 13, lineHeight: 1.55, color: C.n700, margin: 0 }}>
                Revision de automatizaciones y reglas que no operen como se definio
              </p>
            </div>
          </div>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: C.n500, borderTop: `1px solid ${C.n150}`, paddingTop: 12, margin: "16px 0 0" }}>
            No cubre alcance nuevo, cambios de criterio posteriores a la aceptacion, ni fallas originadas en
            sistemas de terceros.
          </p>
        </div>

        <div style={{ width: "100%", boxSizing: "border-box", background: C.red050, borderRadius: 16, padding: "20px 24px" }}>
          <p style={{ fontFamily: FONT_ALT, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: C.red, margin: "0 0 12px" }}>
            Importante · creditos y ejecucion
          </p>
          <p style={{ fontSize: 15.5, lineHeight: 1.55, color: C.n950, margin: "0 0 14px" }}>
            La ejecucion de los casos de uso incluidos en este plan depende de que existan creditos
            disponibles. No todos los casos quedan cubiertos de forma automatica por el paquete contratado.
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: C.n700, textAlign: "justify", margin: 0 }}>
            Para asegurar que el plan se complete, hay dos caminos: cargar desde el inicio el total de
            creditos que suman todos los casos de uso, o ir cargando paquetes de creditos de forma progresiva
            conforme avanza el servicio. Si los creditos se agotan, la ejecucion se detiene hasta que se
            cargue un nuevo paquete.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Desglose — one or more pages per stage                            */}
      {/* ---------------------------------------------------------------- */}
      {breakdownGroups.map(({ status, items }, groupIndex) => {
        const chunks = chunkItems(items, 3);
        return chunks.map((pageItems, chunkIndex) => {
          const isVeryFirstPage = groupIndex === 0 && chunkIndex === 0;
          const isVeryLastPage = groupIndex === lastGroupIndex && chunkIndex === chunks.length - 1;

          return (
            <div
              key={`${pageIdPrefix}-breakdown-${status}-${chunkIndex}`}
              id={`${pageIdPrefix}-breakdown-${status}-${chunkIndex}`}
              data-report-page="true"
              style={pageStyle(0.5)}
            >
              {isVeryFirstPage ? (
                <>
                  <SectionHeading eyebrow="DESGLOSE" title="Casos de uso en detalle" />
                  <p style={{ fontSize: 14, lineHeight: 1.75, color: C.n700, textAlign: "justify", margin: "0 0 30px" }}>
                    Cada caso de uso se describe con tres elementos: el <span style={{ color: C.n950 }}>alcance</span>{" "}
                    que asumimos, las <span style={{ color: C.n950 }}>responsabilidades del cliente</span> que lo
                    hacen posible, y el <span style={{ color: C.n950 }}>criterio de exito</span> con el que se da por
                    concluido.
                  </p>
                </>
              ) : null}

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <p style={{ fontFamily: FONT_ALT, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: C.red, margin: 0 }}>
                  {STAGE_LABELS[status]}
                  {chunkIndex > 0 ? " (cont.)" : ""}
                </p>
                <span style={{ flex: 1, height: 1, background: C.n200 }} />
              </div>

              {pageItems.map((initiative, itemIndex) => (
                <div
                  key={initiative.id}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border: status === "backlog" ? `1px dashed ${C.n400}` : `1px solid ${C.n200}`,
                    borderRadius: 16,
                    overflow: "hidden",
                    marginBottom: itemIndex === pageItems.length - 1 && isVeryLastPage ? 30 : 34,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: "14px 20px",
                      background: status === "executing" ? C.red050 : "transparent",
                      borderBottom: status === "backlog" ? `1px dashed ${C.n300}` : `1px solid ${C.n200}`,
                    }}
                  >
                    <p style={{ fontSize: 17, lineHeight: 1.3, color: C.n950, margin: 0 }}>{initiative.title}</p>
                    <p
                      style={{
                        fontFamily: FONT_ALT,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        color: status === "backlog" ? C.n500 : C.red,
                        margin: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {getBreakdownCreditsLabel(initiative)}
                    </p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                    <div style={{ padding: "16px 20px", borderRight: `1px solid ${C.n150}` }}>
                      <FieldLabel>Alcance</FieldLabel>
                      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: C.n700, margin: 0 }}>
                        {initiative.description || "Sin descripcion detallada."}
                      </p>
                    </div>
                    <div style={{ padding: "16px 20px", borderRight: `1px solid ${C.n150}` }}>
                      <FieldLabel>Responsabilidades del cliente</FieldLabel>
                      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: C.n700, margin: 0 }}>
                        {initiative.completionOutcome || "Sin responsabilidades definidas."}
                      </p>
                    </div>
                    <div style={{ padding: "16px 20px" }}>
                      <FieldLabel>Criterio de exito</FieldLabel>
                      <p style={{ fontSize: 12.5, lineHeight: 1.6, color: C.n700, margin: 0 }}>
                        {initiative.successMilestone || "Sin criterio de exito definido."}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {isVeryLastPage ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 20,
                    alignItems: "center",
                    background: C.red050,
                    borderRadius: 16,
                    padding: "20px 24px",
                  }}
                >
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: C.n950, margin: 0 }}>
                    Total de creditos considerados entre las etapas incluidas en este plan, incluyendo las
                    estimaciones en evaluacion.
                  </p>
                  <p
                    style={{
                      fontFamily: FONT_ALT,
                      fontWeight: 700,
                      fontSize: 32,
                      lineHeight: 1,
                      letterSpacing: "-0.03em",
                      color: C.n950,
                      margin: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {totalBreakdownCredits} creditos
                  </p>
                </div>
              ) : null}
            </div>
          );
        });
      })}

      {/* ---------------------------------------------------------------- */}
      {/* Condiciones                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div id={`${pageIdPrefix}-terms`} data-report-page="true" style={pageStyle(0.3)}>
        <SectionHeading eyebrow="ALCANCE Y TERMINOS" marginBottom={22} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 18 }}>
          {[
            {
              title: "Vigencia de la propuesta",
              body: `${PROPOSAL_VALIDITY_LABEL} a partir de la fecha indicada en la portada. Pasado ese plazo, los valores y el plan de trabajo pueden ajustarse.`,
            },
            {
              title: "Activacion y Kickoff",
              body: "Una vez activado el servicio, la sesion de Kickoff se agenda entre 3 y 7 dias, segun la disponibilidad del equipo al momento de la activacion.",
            },
            {
              title: "Uso de creditos",
              body: "Los creditos se consumen por caso de uso ejecutado y su avance es visible en la plataforma. Al agotarse, la ejecucion continua con la carga de un nuevo paquete.",
            },
            {
              title: "Alcance y cambios",
              body: "Lo no descrito en el desglose no forma parte del alcance. Todo caso adicional se cotiza en creditos y se acuerda antes de iniciarlo.",
            },
            {
              title: "Impuestos y pago",
              body: "Los valores se expresan en dolares estadounidenses, antes de impuestos: no incluyen impuestos ni retenciones aplicables en el pais del cliente.",
            },
            {
              title: "Licencias de HubSpot",
              body: "Esta propuesta cubre servicios de consultoria e implementacion. Las licencias de HubSpot y de terceros se contratan por separado.",
            },
            {
              title: "Dependencias",
              body: "El cronograma asume que las responsabilidades del cliente se cumplen en los tiempos acordados. Los retrasos externos desplazan las fechas proyectadas.",
            },
            {
              title: "Confidencialidad",
              body: "El contenido de esta propuesta y la informacion compartida durante el proyecto se tratan como confidenciales por ambas partes.",
            },
          ].map((card) => (
            <div key={card.title} style={{ border: `1px solid ${C.n200}`, borderRadius: 14, padding: "13px 16px" }}>
              <FieldLabel tone={C.red}>{card.title}</FieldLabel>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: C.n700, margin: 0 }}>{card.body}</p>
            </div>
          ))}
        </div>

        {publicUrl ? (
          <div
            style={{
              width: "100%",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              flexWrap: "wrap",
              background: C.red050,
              borderRadius: 16,
              padding: "18px 22px",
              marginBottom: 18,
            }}
          >
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: C.n950, margin: 0, maxWidth: "30em" }}>
              El plan de trabajo esta disponible en linea, junto con el catalogo completo de casos de uso.
              Desde ahi tambien se activa el servicio y se agenda la sesion inicial de Kickoff.
            </p>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                data-pdf-link="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  background: C.n950,
                  color: "#fff",
                  textDecoration: "none",
                  borderRadius: 999,
                  padding: "12px 24px",
                  fontFamily: FONT_ALT,
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: "16px",
                  letterSpacing: "0.02em",
                }}
              >
                Ver plan de trabajo en linea
              </a>
              <p style={{ fontSize: 10.5, lineHeight: 1.4, color: C.n500, margin: 0, wordBreak: "break-all", maxWidth: "20em" }}>
                {publicUrl}
              </p>
            </div>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginBottom: 18 }}>
          <div>
            <div style={{ borderBottom: `1px solid ${C.n400}`, height: 32 }} />
            <p style={{ fontFamily: FONT_ALT, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.n500, margin: "8px 0 0" }}>
              Por {clientName}
            </p>
          </div>
          <div>
            <div style={{ borderBottom: `1px solid ${C.n400}`, height: 32 }} />
            <p style={{ fontFamily: FONT_ALT, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.n500, margin: "8px 0 0" }}>
              Por Dinterweb
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, borderTop: `1px solid ${C.n150}`, paddingTop: 16 }}>
          <img src="/proposal/dinterweb-logo.png" alt="dinterweb" style={{ height: 22, width: "auto", display: "block" }} />
          <p style={{ fontFamily: FONT_ALT, fontSize: 10, fontWeight: 500, letterSpacing: "0.13em", textTransform: "uppercase", color: C.n500, margin: 0 }}>
            HubSpot Elite Partner · dinterweb.com
          </p>
          <span style={{ flex: 1 }} />
          <p style={{ fontSize: 11, lineHeight: 1.5, color: C.n500, margin: 0, textAlign: "right" }}>
            Terminos y condiciones: dinterweb.com/terminos
          </p>
        </div>
      </div>
    </div>
  );
}
