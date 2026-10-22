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
 * start applying. SyncService raises the event once per account and workspace,
 * so there is nothing to dedupe here. Sync passes run in whichever window holds
 * the web lock (often the dictation overlay), so the event arrives through the
 * main process's 'sync-event' rebroadcast, not as a window-local event.
 */
export default function SharedDictionaryArrivalToastListener({
  onViewWords,
}: SharedDictionaryArrivalToastListenerProps): null {
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    const handleArrival = (detail: SharedDictionaryArrivedDetail | undefined): void => {
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

    return window.electronAPI?.onSyncEvent?.(({ name, payload }) => {
      if (name === "shared-dictionary-arrived") {
        handleArrival(payload as SharedDictionaryArrivedDetail | undefined);
      }
    });
  }, [toast, t, onViewWords]);

  return null;
}
