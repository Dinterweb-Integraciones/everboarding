"use client";

import { Copy, Link2, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPriceListLinkPath, type PriceListLink } from "@/lib/price-list-links";
import { formatDate, formatUserError } from "@/lib/utils";

type PriceListLinksModalProps = {
  priceListId: string;
  priceListName: string;
  priceListIsActive: boolean;
  links: PriceListLink[];
  onLinksChange: (updater: (current: PriceListLink[]) => PriceListLink[]) => void;
  onFeedback: (feedback: { tone: "success" | "error"; message: string }) => void;
  onClose: () => void;
};

// Enlaces de la lista para vendedores externos: quien tenga la URL cotiza sin iniciar sesión, con
// la tarifa de la lista fija. Desactivar o eliminar el enlace corta el acceso de inmediato.
export function PriceListLinksModal({
  priceListId,
  priceListName,
  priceListIsActive,
  links,
  onLinksChange,
  onFeedback,
  onClose,
}: PriceListLinksModalProps) {
  const [label, setLabel] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  function getLinkUrl(link: PriceListLink) {
    return `${window.location.origin}${getPriceListLinkPath(link.token)}`;
  }

  async function copyLink(link: PriceListLink) {
    try {
      await navigator.clipboard.writeText(getLinkUrl(link));
      onFeedback({ tone: "success", message: "Enlace copiado." });
    } catch {
      onFeedback({ tone: "error", message: "No pudimos copiar el enlace. Cópialo manualmente." });
    }
  }

  async function createLink() {
    setIsCreating(true);

    try {
      const response = await fetch(`/api/cs/price-lists/${priceListId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const payload = (await response.json()) as PriceListLink & { message?: string };

      if (!response.ok) throw new Error(payload.message || "No pudimos crear el enlace.");

      onLinksChange((current) => [...current, payload]);
      setLabel("");
      await copyLink(payload);
    } catch (caughtError) {
      onFeedback({ tone: "error", message: formatUserError(caughtError, "No pudimos crear el enlace.") });
    } finally {
      setIsCreating(false);
    }
  }

  async function toggleLink(link: PriceListLink) {
    setBusyLinkId(link.id);

    try {
      const response = await fetch(`/api/cs/price-list-links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !link.is_active }),
      });
      const payload = (await response.json()) as PriceListLink & { message?: string };

      if (!response.ok) throw new Error(payload.message || "No pudimos actualizar el enlace.");

      onLinksChange((current) => current.map((entry) => (entry.id === link.id ? payload : entry)));
      onFeedback({ tone: "success", message: payload.is_active ? "Enlace activado." : "Enlace desactivado." });
    } catch (caughtError) {
      onFeedback({ tone: "error", message: formatUserError(caughtError, "No pudimos actualizar el enlace.") });
    } finally {
      setBusyLinkId(null);
    }
  }

  async function deleteLink(link: PriceListLink) {
    if (!window.confirm("¿Eliminar este enlace? Quien lo tenga ya no podrá cotizar con él.")) return;

    setBusyLinkId(link.id);

    try {
      const response = await fetch(`/api/cs/price-list-links/${link.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) throw new Error(payload.message || "No pudimos eliminar el enlace.");

      onLinksChange((current) => current.filter((entry) => entry.id !== link.id));
      onFeedback({ tone: "success", message: "Enlace eliminado." });
    } catch (caughtError) {
      onFeedback({ tone: "error", message: formatUserError(caughtError, "No pudimos eliminar el enlace.") });
    } finally {
      setBusyLinkId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-list-links-title"
        className="flex max-h-[85vh] w-full max-w-[720px] flex-col rounded-[18px] border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Vendedores externos</p>
            <h2 id="price-list-links-title" className="text-xl font-black text-slate-900">
              Enlaces de {priceListName}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Quien tenga el enlace crea propuestas sin iniciar sesión, con esta tarifa fija (paquete, moneda y
              créditos). Desactívalo o elimínalo para cortar el acceso.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!priceListIsActive ? (
          <p className="mt-4 rounded-[10px] bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
            La lista está inactiva: sus enlaces no funcionan hasta que la vuelvas a activar.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Etiqueta (opcional, nombre del vendedor en sus propuestas): Socios España"
            maxLength={120}
          />
          <Button type="button" onClick={() => void createLink()} disabled={isCreating} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            {isCreating ? "Creando..." : "Crear enlace"}
          </Button>
        </div>

        <div className="mt-5 flex-1 space-y-2 overflow-y-auto">
          {links.length ? (
            links.map((link) => (
              <div
                key={link.id}
                className="flex flex-col gap-3 rounded-[12px] border border-slate-200 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                    <p className="truncate font-semibold text-slate-800">{link.label || "Enlace sin etiqueta"}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        link.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {link.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-slate-500">
                    {getPriceListLinkPath(link.token)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Creado {formatDate(link.created_at)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="ghost" onClick={() => void copyLink(link)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void toggleLink(link)}
                    disabled={busyLinkId === link.id}
                  >
                    {link.is_active ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void deleteLink(link)}
                    disabled={busyLinkId === link.id}
                    aria-label="Eliminar enlace"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-[12px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Aún no hay enlaces. Crea uno y compártelo con tus vendedores externos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
