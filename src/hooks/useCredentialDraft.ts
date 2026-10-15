import { useCallback, useState } from "react";

interface CredentialDraft {
  field: string;
  value: string;
  save: (value: string) => void;
}

/**
 * A credential while it is typed. A saved key reaches the main process and every other
 * window, so a panel saves it only when its field is left (a window switch included) or its
 * check passes; until then the panel reads the typed value. A draft belongs to one field, so
 * any other field, such as another provider's key, shows its saved value.
 */
export function useCredentialDraft() {
  const [draft, setDraft] = useState<CredentialDraft | null>(null);
  const save = useCallback(() => {
    if (!draft) return;
    draft.save(draft.value);
    setDraft(null);
  }, [draft]);
  return {
    value: (field: string, saved: string) => (draft?.field === field ? draft.value : saved),
    change: (field: string, value: string, save: (value: string) => void) =>
      setDraft({ field, value, save }),
    save,
  };
}
