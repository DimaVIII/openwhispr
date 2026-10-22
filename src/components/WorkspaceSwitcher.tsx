import React, { Suspense, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, Loader2, Plus, UserCircle, UserPlus } from "./icons";
import MemberAvatar from "./MemberAvatar";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "./lib/utils";
import { useAuth } from "../hooks/useAuth";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { WorkspacesService } from "../services/WorkspacesService";
import { resolveWorkspaceSwitcher } from "../lib/workspaceSwitcher";
import type { Workspace } from "../types/electron";

const InviteTeammateDialog = React.lazy(() => import("./InviteTeammateDialog"));

const triggerClass =
  "group flex items-center gap-2.5 w-full h-9 px-2.5 rounded-md text-start outline-none hover:bg-foreground/4 dark:hover:bg-white/4 active:bg-foreground/6 data-[state=open]:bg-foreground/5 dark:data-[state=open]:bg-white/6 focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors duration-150";
const nameClass = "flex-1 min-w-0 truncate text-[13px] font-medium text-foreground";
const itemClass = "gap-2.5 px-2 py-1.5 text-[13px]";

export default function WorkspaceSwitcher(): React.ReactElement | null {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const { workspaces, setActive, refresh } = useWorkspace();
  const { activeWorkspaceId, loaded, loading, error } = useWorkspaceStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      loaded: s.loaded,
      loading: s.loading,
      error: s.error,
    }))
  );
  const [createOpen, setCreateOpen] = useState(false);
  // Right after creating a workspace the invite is optional, so it offers Skip.
  const [invite, setInvite] = useState<{ workspace: Workspace; afterCreate: boolean } | null>(null);
  const [memberCount, setMemberCount] = useState<{ workspaceId: string; count: number } | null>(
    null
  );

  const state = resolveWorkspaceSwitcher({
    isSignedIn: Boolean(isSignedIn),
    loaded,
    error,
    workspaces,
    activeWorkspaceId,
  });

  if (state.kind === "hidden") return null;

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2.5 h-9 px-2.5" aria-hidden="true">
        <span className="w-5 h-5 rounded-full bg-foreground/6 dark:bg-white/8 animate-pulse" />
        <span className="h-2.5 w-20 rounded bg-foreground/6 dark:bg-white/8 animate-pulse" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={loading}
        className={cn(triggerClass, "disabled:opacity-60")}
      >
        <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
          {t("settingsPage.workspace.loadError.title")}
        </span>
        {loading ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span className="shrink-0 text-xs font-medium text-primary">
            {t("settingsPage.workspace.loadError.retry")}
          </span>
        )}
      </button>
    );
  }

  const current = state.kind === "workspace" ? state.current : null;
  const currentMemberCount =
    current && memberCount?.workspaceId === current.id ? memberCount.count : null;

  const handleOpenChange = (open: boolean): void => {
    if (!open || !current) return;
    const workspaceId = current.id;
    WorkspacesService.listMembers(workspaceId).then(
      (members) => setMemberCount({ workspaceId, count: members.length }),
      // The count is decoration; the menu works without it.
      () => {}
    );
  };

  return (
    <>
      <DropdownMenu modal={false} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger className={triggerClass}>
          {current ? (
            <MemberAvatar name={current.name} email={null} size="sm" />
          ) : (
            <UserCircle size={20} className="shrink-0 text-foreground/50" />
          )}
          <span dir="auto" className={nameClass}>
            {current ? current.name : t("notes.spaces.personal")}
          </span>
          <ChevronsUpDown
            size={14}
            className="shrink-0 text-foreground/45 group-hover:text-foreground/70 transition-colors duration-150"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width)"
        >
          {current && (
            <>
              <div className="flex items-center gap-2.5 px-2 pt-1 pb-2">
                <MemberAvatar name={current.name} email={null} />
                <div className="min-w-0">
                  <p dir="auto" className="truncate text-[13px] font-medium text-foreground">
                    {current.name}
                  </p>
                  {currentMemberCount !== null && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("workspaces.join.memberCount", { count: currentMemberCount })}
                    </p>
                  )}
                </div>
              </div>
              {state.kind === "workspace" && state.canInvite && (
                <DropdownMenuItem
                  onSelect={() => setInvite({ workspace: current, afterCreate: false })}
                  className="mb-1 justify-center gap-1.5 py-1.5 text-xs text-foreground/80 bg-foreground/4 dark:bg-white/5 focus:bg-foreground/8 dark:focus:bg-white/10"
                >
                  <UserPlus size={13} />
                  {t("sidebar.inviteTeam")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          {current ? (
            workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => setActive(workspace.id)}
                className={itemClass}
              >
                <MemberAvatar name={workspace.name} email={null} size="sm" />
                <span dir="auto" className="flex-1 min-w-0 truncate">
                  {workspace.name}
                </span>
                {workspace.id === current.id && (
                  <Check size={14} className="shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem className={itemClass} disabled>
              <UserCircle size={20} className="shrink-0 text-foreground/50" />
              <span className="flex-1">{t("notes.spaces.personal")}</span>
              <Check size={14} className="shrink-0 text-primary" />
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => setCreateOpen(true)}
            className={cn(itemClass, "text-muted-foreground focus:text-foreground")}
          >
            <span className="flex w-5 shrink-0 justify-center">
              <Plus size={14} />
            </span>
            {t("workspaces.switcher.create")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(workspaceId) => {
          const created = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
          if (created) setInvite({ workspace: created, afterCreate: true });
        }}
      />
      {invite && (
        <Suspense fallback={null}>
          <InviteTeammateDialog
            open
            onOpenChange={(open) => {
              if (!open) setInvite(null);
            }}
            workspaceId={invite.workspace.id}
            workspaceName={invite.workspace.name}
            cancelLabel={invite.afterCreate ? t("common.skip") : undefined}
          />
        </Suspense>
      )}
    </>
  );
}
