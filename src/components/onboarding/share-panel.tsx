"use client";

import { Copy, Link2, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ACCESS_ROLE_META,
  PROFILE_ROLE_META,
  STAGE_META,
} from "@/lib/constants";
import type {
  ClientAccessRole,
  ClientMemberRecord,
  ClientProfileRole,
  ProjectStage,
  ShareLinkRecord,
} from "@/lib/onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDate, formatUserError } from "@/lib/utils";

type SharePanelProps = {
  clientId: string;
  userId: string;
  accessRole: ClientAccessRole;
  shareLinks: ShareLinkRecord[];
  members: ClientMemberRecord[];
  onShareLinksChange: (links: ShareLinkRecord[]) => void;
  onMembersChange: (members: ClientMemberRecord[]) => void;
  onError: (message: string | null) => void;
  onSuccess: (message: string) => void;
};

export function SharePanel({
  clientId,
  userId,
  accessRole,
  shareLinks,
  members,
  onShareLinksChange,
  onMembersChange,
  onError,
  onSuccess,
}: SharePanelProps) {
  const supabase = createSupabaseBrowserClient();
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [profileRole, setProfileRole] = useState<ClientProfileRole>("client");
  const [stageScope, setStageScope] = useState<ProjectStage>("client");
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [isCreating, setIsCreating] = useState(false);

  function resolveProfileRole(value: string | null | undefined): ClientProfileRole {
    if (value && value in PROFILE_ROLE_META) {
      return value as ClientProfileRole;
    }

    return "stakeholder";
  }

  function resolveStageScope(value: string | null | undefined): ProjectStage {
    if (value && value in STAGE_META) {
      return value as ProjectStage;
    }

    return "client";
  }

  function resolveAccessRole(value: string | null | undefined): "viewer" | "editor" {
    return value === "editor" ? "editor" : "viewer";
  }

  if (accessRole !== "owner") {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Compartir onboarding</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Solo el propietario del cliente puede generar enlaces y administrar permisos.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  async function createShareLink() {
    onError(null);
    setIsCreating(true);

    try {
      const expiresAt = expiresInDays
        ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const { data, error } = await supabase
        .from("client_share_links")
        .insert({
          client_id: clientId,
          access_role: role,
          profile_role: profileRole,
          stage_scope: stageScope,
          created_by_user_id: userId,
          expires_at: expiresAt,
        })
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      onShareLinksChange([data, ...shareLinks]);
      onSuccess("Enlace compartido creado correctamente.");
    } catch (caughtError) {
      onError(
        formatUserError(caughtError, "No fue posible crear el enlace compartido."),
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function revokeLink(linkId: string) {
    onError(null);
    const { data, error } = await supabase
      .from("client_share_links")
      .update({
        revoked_at: new Date().toISOString(),
      })
      .eq("id", linkId)
      .select("*")
      .single();

    if (error) {
      onError(formatUserError(error.message, "No fue posible actualizar el acceso."));
      return;
    }

    onShareLinksChange(shareLinks.map((link) => (link.id === linkId ? data : link)));
    onSuccess("Enlace revocado.");
  }

  async function updateMemberAccessRole(
    member: ClientMemberRecord,
    nextRole: "viewer" | "editor",
  ) {
    onError(null);

    const { data, error } = await supabase
      .from("client_members")
      .update({
        access_role: nextRole,
      })
      .eq("client_id", member.client_id)
      .eq("user_id", member.user_id)
      .select("*")
      .single();

    if (error) {
      onError(formatUserError(error.message, "No fue posible actualizar el perfil."));
      return;
    }

    onMembersChange(
      members.map((currentMember) =>
        currentMember.user_id === member.user_id
          ? { ...currentMember, ...data }
          : currentMember,
      ),
    );
    onSuccess("Permiso actualizado.");
  }

  async function updateMemberProfileRole(
    member: ClientMemberRecord,
    nextRole: ClientProfileRole,
  ) {
    onError(null);

    const { data, error } = await supabase
      .from("client_members")
      .update({
        profile_role: nextRole,
      })
      .eq("client_id", member.client_id)
      .eq("user_id", member.user_id)
      .select("*")
      .single();

    if (error) {
      onError(formatUserError(error.message, "No fue posible remover el acceso."));
      return;
    }

    onMembersChange(
      members.map((currentMember) =>
        currentMember.user_id === member.user_id
          ? { ...currentMember, ...data }
          : currentMember,
      ),
    );
    onSuccess("Perfil actualizado.");
  }

  async function removeMember(member: ClientMemberRecord) {
    onError(null);
    const confirmed = window.confirm(
      `Se quitara el acceso de ${member.full_name || member.email || "este usuario"}.`,
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("client_members")
      .delete()
      .eq("client_id", member.client_id)
      .eq("user_id", member.user_id);

    if (error) {
      onError(formatUserError(error.message, "No fue posible revocar el enlace."));
      return;
    }

    onMembersChange(members.filter((currentMember) => currentMember.user_id !== member.user_id));
    onSuccess("Acceso removido.");
  }

  function copyLink(link: ShareLinkRecord) {
    const stage = resolveStageScope(link.stage_scope);
    const url = `${window.location.origin}/shared/${link.token}?stage=${stage}`;
    navigator.clipboard.writeText(url).then(() => {
      onSuccess("Enlace copiado al portapapeles.");
    });
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Link2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">Compartir onboarding</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Crea enlaces por etapa y por perfil para ventas, CS o cliente, manteniendo
              un solo proyecto con vistas distintas.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">Permiso</span>
            <Select value={role} onChange={(event) => setRole(event.target.value as "viewer" | "editor")}>
              <option value="viewer">Solo lectura</option>
              <option value="editor">Lectura y escritura</option>
            </Select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">Perfil</span>
            <Select
              value={profileRole}
              onChange={(event) => setProfileRole(event.target.value as ClientProfileRole)}
            >
              {Object.entries(PROFILE_ROLE_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">Vista</span>
            <Select
              value={stageScope}
              onChange={(event) => setStageScope(event.target.value as ProjectStage)}
            >
              {Object.entries(STAGE_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">Expira en dias</span>
            <Input
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-4">
          <Button className="w-full md:w-auto" onClick={createShareLink} disabled={isCreating}>
            {isCreating ? "Creando..." : "Crear enlace"}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-lg font-semibold text-slate-900">Enlaces generados</h3>
        <div className="mt-4 space-y-3">
          {shareLinks.length ? (
            shareLinks.map((link) => {
              const accessMeta = ACCESS_ROLE_META[resolveAccessRole(link.access_role)];
              const profileMeta = PROFILE_ROLE_META[resolveProfileRole(link.profile_role)];
              const stageMeta = STAGE_META[resolveStageScope(link.stage_scope)];

              return (
                <div
                  key={link.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-slate-100 text-slate-700">
                      {accessMeta.label}
                    </Badge>
                    <Badge className="bg-orange-50 text-orange-700">
                      {profileMeta.label}
                    </Badge>
                    <Badge className="bg-sky-50 text-sky-700">
                      {stageMeta.label}
                    </Badge>
                    {link.revoked_at ? (
                      <Badge className="bg-rose-100 text-rose-700">Revocado</Badge>
                    ) : null}
                    <span className="text-xs text-slate-500">
                      Creado: {formatDate(link.created_at)}
                    </span>
                    <span className="text-xs text-slate-500">
                      Expira: {link.expires_at ? formatDate(link.expires_at) : "Sin vencimiento"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={() => copyLink(link)} disabled={Boolean(link.revoked_at)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar
                    </Button>
                    {!link.revoked_at ? (
                      <Button variant="danger" onClick={() => revokeLink(link.id)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Revocar
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">Todavia no has creado enlaces compartidos.</p>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-lg font-semibold text-slate-900">Usuarios con acceso</h3>
        <div className="mt-4 space-y-3">
          {members.length ? (
            members.map((member) => (
              <div
                key={member.user_id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {member.full_name || "Usuario compartido"}
                  </p>
                  <p className="text-sm text-slate-500">{member.email || "Email no disponible"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={resolveAccessRole(member.access_role)}
                    onChange={(event) =>
                      updateMemberAccessRole(member, event.target.value as "viewer" | "editor")
                    }
                    className="min-w-40"
                  >
                    <option value="viewer">Solo lectura</option>
                    <option value="editor">Editor</option>
                  </Select>
                  <Select
                    value={resolveProfileRole(member.profile_role)}
                    onChange={(event) =>
                      updateMemberProfileRole(
                        member,
                        event.target.value as ClientProfileRole,
                      )
                    }
                    className="min-w-40"
                  >
                    {Object.entries(PROFILE_ROLE_META).map(([value, meta]) => (
                      <option key={value} value={value}>
                        {meta.label}
                      </option>
                    ))}
                  </Select>
                  <Button variant="danger" onClick={() => removeMember(member)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Quitar
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">
              Aun no hay usuarios adicionales con acceso a este cliente.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
