import { useTranslation } from "react-i18next";
import type { ConnectionAutoCheck } from "../../hooks/useConnectionAutoCheck";

/**
 * A Settings panel's voice for its automatic check: "Testing…" for a slow request,
 * "Connected" once per result. It mounts with the panel, so the region exists before it
 * speaks, and a panel that TabPanel hides is out of the accessibility tree. Render it
 * first in a space-y column, where a last child would add a margin under the panel.
 */
export function ConnectionCheckAnnouncer({
  announcement,
}: Pick<ConnectionAutoCheck, "announcement">) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement === "connected"
        ? t("onboarding.rehaul.provider.connected")
        : announcement === "testing"
          ? t("onboarding.rehaul.provider.testing")
          : ""}
    </div>
  );
}
