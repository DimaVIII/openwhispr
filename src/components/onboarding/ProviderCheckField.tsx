import { useId, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConnectionAutoCheck,
  ProviderConnectionResult,
} from "../../hooks/useConnectionAutoCheck";
import { cn } from "../lib/utils";
import { ConnectionStatusIcon } from "../ui/ConnectionStatusIcon";
import { Input } from "../ui/input";

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs text-[var(--onboarding-text-tertiary)]">{children}</span>
  );
}

// A refused key or a missing model is about what was entered; a network, timeout or status
// failure says nothing about it.
const VALUE_REJECTED = new Set(["credentialsRejected", "modelNotFound"]);

type ProviderCheckFieldProps = Omit<
  ComponentProps<typeof Input>,
  "dir" | "aria-invalid" | "aria-describedby"
> & {
  label: string;
  check: Pick<ConnectionAutoCheck, "phase" | "failure" | "retry">;
};

/**
 * The field that completes the provider form. It carries the automatic check's status at
 * its end and, when the check fails, the reason with Retry directly underneath.
 */
export function ProviderCheckField({
  label,
  check,
  className,
  ...inputProps
}: ProviderCheckFieldProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  const { phase, failure, retry } = check;
  const describe = (result: ProviderConnectionResult) =>
    result.errorCode
      ? t(`onboarding.rehaul.provider.errors.${result.errorCode}`, {
          status: result.status,
          defaultValue: result.error ?? t("onboarding.rehaul.provider.connectionFailed"),
        })
      : (result.error ?? t("onboarding.rehaul.provider.connectionFailed"));

  return (
    <div>
      <label className="block">
        <FieldLabel>{label}</FieldLabel>
        {/* The value reads left to right in every language, so its status sits at the
            field's own end. */}
        <span dir="ltr" className="relative block">
          <Input
            dir="ltr"
            {...inputProps}
            aria-invalid={failure && VALUE_REJECTED.has(failure.errorCode ?? "") ? true : undefined}
            aria-describedby={reasonId}
            className={cn(className, phase !== "idle" && "pe-9")}
          />
          {phase !== "idle" && (
            <ConnectionStatusIcon
              state={phase === "connected" || phase === "failed" ? phase : "checking"}
              className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2"
            />
          )}
        </span>
      </label>
      <p className={failure ? "mt-1 px-1 text-xs leading-[1.4] text-destructive" : undefined}>
        <span id={reasonId} role="alert">
          {failure && describe(failure)}
        </span>
        {failure && (
          <>
            {" "}
            <button
              type="button"
              onClick={retry}
              className="font-medium underline underline-offset-2 hover:opacity-70"
            >
              {t("common.retry")}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
