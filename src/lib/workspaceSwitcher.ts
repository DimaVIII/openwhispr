import type { Workspace } from "../types/electron";
import { canManageWorkspace } from "./spacePermissions.ts";

export type WorkspaceSwitcherState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "personal" }
  | { kind: "workspace"; current: Workspace; canInvite: boolean };

interface WorkspaceSwitcherInput {
  isSignedIn: boolean;
  loaded: boolean;
  error: boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

export function resolveWorkspaceSwitcher({
  isSignedIn,
  loaded,
  error,
  workspaces,
  activeWorkspaceId,
}: WorkspaceSwitcherInput): WorkspaceSwitcherState {
  if (!isSignedIn) return { kind: "hidden" };
  if (!loaded) return { kind: "loading" };
  if (workspaces.length === 0) return error ? { kind: "error" } : { kind: "personal" };
  // Settings shows the first workspace when none is active, so the switcher does too.
  const current = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  return { kind: "workspace", current, canInvite: canManageWorkspace(current.role) };
}
