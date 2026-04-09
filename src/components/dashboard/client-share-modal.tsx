"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { SharePanel } from "@/components/onboarding/share-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ClientMemberRecord, ShareLinkRecord } from "@/lib/onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatUserError } from "@/lib/utils";

type ClientShareModalProps = {
  clientId: string;
  clientName: string;
  isOpen: boolean;
  onClose: () => void;
};

export function ClientShareModal({
  clientId,
  clientName,
  isOpen,
  onClose,
}: ClientShareModalProps) {
  const supabase = createSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [shareLinks, setShareLinks] = useState<ShareLinkRecord[]>([]);
  const [members, setMembers] = useState<ClientMemberRecord[]>([]);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isMounted = true;

    async function loadShareData() {
      setIsLoading(true);
      setFeedback(null);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("No pudimos validar la sesion actual.");
        }

        const [{ data: shareLinkRows, error: shareLinksError }, { data: memberRows, error: membersError }] =
          await Promise.all([
            supabase
              .from("client_share_links")
              .select("*")
              .eq("client_id", clientId)
              .order("created_at", { ascending: false }),
            supabase.from("client_members").select("*").eq("client_id", clientId),
          ]);

        if (shareLinksError) {
          throw shareLinksError;
        }

        if (membersError) {
          throw membersError;
        }

        const memberRecords = (memberRows ?? []) as Array<{
          client_id: string;
          user_id: string;
          access_role: "viewer" | "editor" | "owner";
          profile_role: "sales" | "csm" | "client" | "stakeholder";
          added_by_user_id: string | null;
          accepted_at: string;
          created_at: string;
          updated_at: string;
        }>;

        const profileIds = memberRecords.map((member) => member.user_id);
        const { data: profileRows, error: profilesError } = profileIds.length
          ? await supabase.from("profiles").select("id, email, full_name").in("id", profileIds)
          : { data: [], error: null };

        if (profilesError) {
          throw profilesError;
        }

        const profileMap = new Map(
          ((profileRows ?? []) as Array<{ id: string; email: string; full_name: string | null }>).map(
            (profile) => [profile.id, profile],
          ),
        );

        if (!isMounted) {
          return;
        }

        setUserId(user.id);
        setShareLinks((shareLinkRows ?? []) as ShareLinkRecord[]);
        setMembers(
          memberRecords.map((member) => ({
            ...member,
            email: profileMap.get(member.user_id)?.email ?? null,
            full_name: profileMap.get(member.user_id)?.full_name ?? null,
          })),
        );
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }

        setFeedback({
          tone: "error",
          message: formatUserError(caughtError, "No fue posible cargar los accesos de este cliente."),
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadShareData();

    return () => {
      isMounted = false;
    };
  }, [clientId, isOpen, supabase]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
      <Card className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Compartir onboarding
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-950">{clientName}</h3>
            <p className="mt-2 text-sm text-slate-600">
              Gestiona enlaces y accesos sin salir del dashboard.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            Cerrar
          </Button>
        </div>

        {feedback ? (
          <div
            className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
              feedback.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex min-h-60 items-center justify-center text-slate-500">
            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
            Cargando accesos...
          </div>
        ) : userId ? (
          <div className="mt-6">
            <SharePanel
              clientId={clientId}
              userId={userId}
              accessRole="owner"
              shareLinks={shareLinks}
              members={members}
              onShareLinksChange={setShareLinks}
              onMembersChange={setMembers}
              onError={(message) =>
                setFeedback(message ? { tone: "error", message } : null)
              }
              onSuccess={(message) => setFeedback({ tone: "success", message })}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
