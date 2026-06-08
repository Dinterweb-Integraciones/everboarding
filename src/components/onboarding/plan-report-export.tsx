import { STATUS_META } from "@/lib/constants";
import type { InitiativeStatus } from "@/lib/onboarding";

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
  credits: number;
  status: InitiativeStatus;
  dateRange: string;
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
  reportLabel: string;
  clientName: string;
  description: string;
  startDateLabel: string;
  stageLabel: string;
  metrics: PlanReportMetrics;
  groupedInitiatives: Record<InitiativeStatus, PlanReportInitiative[]>;
};

const reportStatuses: InitiativeStatus[] = ["executing", "planned", "backlog", "completed"];

function getStatusDotColor(status: InitiativeStatus) {
  if (status === "executing") return "bg-[#00bda5]";
  if (status === "planned") return "bg-[#6a78d1]";
  if (status === "completed") return "bg-[#33475b]";
  return "bg-[#cbd6e2]";
}

function chunkItems<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks.length ? chunks : [[]];
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

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;

  for (const [index, page] of pages.entries()) {
    const canvas = await html2canvas(page, {
      scale: 1.6,
      backgroundColor: "#f5f8fa",
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
    const usableWidth = pdfWidth - margin * 2;
    const usableHeight = pdfHeight - margin * 2;
    const ratio = Math.min(usableWidth / canvas.width, usableHeight / canvas.height);
    const renderWidth = canvas.width * ratio;
    const renderHeight = canvas.height * ratio;
    const offsetX = (pdfWidth - renderWidth) / 2;
    const offsetY = (pdfHeight - renderHeight) / 2;

    if (index > 0) {
      pdf.addPage();
    }

    pdf.addImage(imageData, "PNG", offsetX, offsetY, renderWidth, renderHeight);
  }

  pdf.save(filename);
}

export function PlanReportExportPages({
  rootId,
  pageIdPrefix,
  reportLabel,
  clientName,
  description,
  startDateLabel,
  stageLabel,
  metrics,
  groupedInitiatives,
}: PlanReportExportPagesProps) {
  const allInitiatives = reportStatuses.flatMap((status) => groupedInitiatives[status]);
  const detailPages = chunkItems(allInitiatives, 5);

  return (
    <div id={rootId} className="pointer-events-none fixed left-[-200vw] top-0 z-[-1]">
      <div id={`${pageIdPrefix}-overview`} data-report-page="true" className="flex w-[1120px] min-h-[790px] flex-col bg-[#f5f8fa] px-10 py-8 text-[#33475b]">
        <div className="flex items-start justify-between border-b border-[#dfe3eb] pb-5">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8aa0b4]">
              {reportLabel}
            </p>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.03em] text-[#33475b]">
              Plan detallado
            </h1>
            <p className="mt-2 text-[14px] text-[#516f90]">
              {clientName} · {startDateLabel} · {stageLabel}
            </p>
          </div>
          <div className="max-w-[340px] rounded-[14px] border border-[#dfe3eb] bg-white px-5 py-4 text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8aa0b4]">
              Contexto
            </p>
            <p className="mt-2 text-[13px] leading-6 text-[#516f90]">
              {description || "Plan de trabajo y alcance comercial definido para el cliente."}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-5 gap-4">
          <div className="rounded-[14px] border border-[#d9eee9] bg-[#ecfffb] px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#00a88f]">Disponibles</p>
            <p className="mt-2 text-[24px] font-bold text-[#00bda5]">{metrics.available} CR</p>
          </div>
          <div className="rounded-[14px] border border-[#e2e5fb] bg-[#f2f4ff] px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5865c7]">Comprometidos</p>
            <p className="mt-2 text-[24px] font-bold text-[#6a78d1]">{metrics.committed} CR</p>
          </div>
          <div className="rounded-[14px] border border-[#dfe3eb] bg-white px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">Completados</p>
            <p className="mt-2 text-[24px] font-bold text-[#33475b]">{metrics.completed} CR</p>
          </div>
          <div className="rounded-[14px] border border-[#e5e7eb] bg-[#f8fafc] px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Plan</p>
            <p className="mt-2 text-[24px] font-bold text-[#33475b]">{metrics.creditsLabel}</p>
          </div>
          <div className="rounded-[14px] border border-[#ffe3d9] bg-[#fff7f4] px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#c65d45]">Inversion</p>
            <p className="mt-2 text-[24px] font-bold text-[#33475b]">{metrics.priceLabel}</p>
          </div>
        </div>

        <div className="mt-8 grid flex-1 grid-cols-4 gap-5">
          {reportStatuses.map((status) => {
            const items = groupedInitiatives[status];
            const credits = items.reduce((sum, initiative) => sum + initiative.credits, 0);

            return (
              <div key={`${pageIdPrefix}-status-${status}`} className="rounded-[10px] border border-[#dfe3eb] bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(status)}`} />
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#33475b]">
                      {STATUS_META[status].label}
                    </h2>
                  </div>
                  <span className="rounded-[3px] bg-[#eaf0f6] px-2 py-1 text-[10px] font-bold text-[#516f90]">
                    {credits} CR
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {items.slice(0, 4).map((initiative) => (
                    <div key={`${pageIdPrefix}-preview-${initiative.id}`} className="rounded-[6px] border border-[#eaf0f6] bg-[#fcfcfc] p-3">
                      <p className="text-[11px] font-bold leading-snug text-[#33475b]">{initiative.title}</p>
                      <p className="mt-1 text-[10px] leading-4 text-[#516f90]">{initiative.dateRange}</p>
                      <p className="mt-2 text-[10px] leading-4 text-[#516f90]">
                        {initiative.description || "Sin descripcion ejecutiva."}
                      </p>
                    </div>
                  ))}
                  {!items.length ? (
                    <div className="rounded-[6px] border border-dashed border-[#dfe3eb] bg-[#f8fafc] px-3 py-8 text-center text-[10px] text-[#9cb1c6]">
                      Sin iniciativas
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {detailPages.map((pageItems, pageIndex) => (
        <div key={`${pageIdPrefix}-detail-page-${pageIndex}`} id={`${pageIdPrefix}-detail-${pageIndex + 1}`} data-report-page="true" className="flex w-[1120px] min-h-[790px] flex-col bg-[#f5f8fa] px-10 py-8 text-[#33475b]">
          <div className="flex items-end justify-between border-b border-[#dfe3eb] pb-5">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8aa0b4]">
                {reportLabel}
              </p>
              <h1 className="mt-3 text-[34px] font-bold tracking-[-0.03em] text-[#33475b]">
                Desglose de actividades
              </h1>
            </div>
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#8aa0b4]">
              Pagina {pageIndex + 2}
            </p>
          </div>

          <div className="mt-6 flex-1 space-y-4">
            {pageItems.length ? (
              pageItems.map((initiative) => (
                <div key={`${pageIdPrefix}-detail-${initiative.id}`} className="overflow-hidden rounded-[8px] border border-[#dfe3eb] bg-white">
                  <div className="grid gap-4 border-b border-[#eaf0f6] bg-[#f8fafc] px-5 py-4 grid-cols-[1.2fr_0.8fr]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(initiative.status)}`} />
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                          {STATUS_META[initiative.status].label}
                        </p>
                        {initiative.isBlocked ? (
                          <span className="rounded-[2px] bg-[#fee2e2] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#dc2626]">
                            Bloqueado
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-2 text-[16px] font-bold text-[#33475b]">{initiative.title}</h2>
                      <p className="mt-2 text-[11px] leading-5 text-[#516f90]">
                        {initiative.description || "Sin descripcion ejecutiva."}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-[6px] border border-[#dfe3eb] bg-white p-3">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa0b4]">Fechas</p>
                        <p className="mt-2 text-[11px] font-bold text-[#33475b]">{initiative.dateRange}</p>
                      </div>
                      <div className="rounded-[6px] border border-[#dfe3eb] bg-white p-3">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8aa0b4]">Creditos</p>
                        <p className="mt-2 text-[18px] font-bold text-[#33475b]">{initiative.credits} CR</p>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#516f90]">
                      Actividades incluidas
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {initiative.subitems.length ? (
                        initiative.subitems.map((subitem) => (
                          <div key={`${pageIdPrefix}-subitem-${initiative.id}-${subitem.id}`} className="flex items-center justify-between gap-3 rounded-[4px] border border-[#eaf0f6] bg-[#fcfcfc] px-3 py-2 text-[10px] text-[#33475b]">
                            <div className="min-w-0">
                              <p className="truncate font-bold">{subitem.name}</p>
                              {subitem.statusLabel ? (
                                <p className="mt-0.5 text-[9px] text-[#8aa0b4]">{subitem.statusLabel}</p>
                              ) : null}
                            </div>
                            <span className="shrink-0 rounded-[2px] bg-[#eaf0f6] px-2 py-1 text-[9px] font-bold text-[#516f90]">
                              {subitem.quantity} x {subitem.unitCredits} CR
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-2 rounded-[4px] border border-dashed border-[#dfe3eb] bg-[#f8fafc] px-3 py-4 text-center text-[10px] text-[#9cb1c6]">
                          Sin actividades desglosadas
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="grid flex-1 place-items-center rounded-[10px] border border-dashed border-[#dfe3eb] bg-white text-[13px] font-semibold text-[#9cb1c6]">
                Sin iniciativas en el plan.
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
