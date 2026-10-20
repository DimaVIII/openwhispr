import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "./ui/useToast";
import { useSharedDictionaryStore } from "../stores/sharedDictionaryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface SharedDictionaryArrivedDetail {
  workspaceId: string;
  count: number;
}

interface SharedDictionaryArrivalToastListenerProps {
  onViewWords: () => void;
}

/**
 * Headless. Tells a member once, the first time their workspace's shared words
 * start applying. SyncService raises the event once per workspace, so there is
 * nothing to dedupe here.
 */
export default function SharedDictionaryArrivalToastListener({
  onViewWords,
}: SharedDictionaryArrivalToastListenerProps): null {
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    const handleArrival = (event: Event): void => {
      const detail = (event as CustomEvent<SharedDictionaryArrivedDetail | undefined>).detail;
      if (!detail || !(detail.count > 0)) return;

      // The workspace list may not have loaded yet when sync finishes first.
      const workspaceName = useWorkspaceStore
        .getState()
        .workspaces.find((workspace) => workspace.id === detail.workspaceId)?.name;

      toast({
        title: t("dictionary.shared.arrival.title", { count: detail.count }),
        description: workspaceName
          ? t("dictionary.shared.arrival.description", { workspace: workspaceName })
          : t("dictionary.shared.arrival.descriptionNoWorkspace"),
        actions: [
          {
            label: t("dictionary.shared.arrival.viewWords"),
            onClick: () => {
              useSharedDictionaryStore.getState().setRequestedList("allShared");
              onViewWords();
            },
          },
          { label: t("common.dismiss"), onClick: () => undefined },
        ],
        // The user may be mid-dictation when sync lands, so give them time.
        duration: 15000,
      });
    };

    window.addEventListener("shared-dictionary-arrived", handleArrival);
    return () => window.removeEventListener("shared-dictionary-arrived", handleArrival);
  }, [toast, t, onViewWords]);

  return null;
}
