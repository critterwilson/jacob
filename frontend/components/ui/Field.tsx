import { type ReactNode, useId } from "react";

import { cn } from "./cn";

type FieldProps = {
  label: string;
  /** Helper text below the field. Replaced by `error` when set. */
  helperText?: ReactNode;
  /** Error message below the field. Takes precedence over `helperText`. */
  error?: ReactNode;
  /** Hide the label visually but keep it for assistive tech. */
  hideLabel?: boolean;
  required?: boolean;
  className?: string;
  /**
   * Render-prop receives the generated id and aria-describedby so the
   * underlying input/select/textarea can wire them up.
   */
  children: (ctx: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
};

/**
 * Shared label / helper / error chrome for every form field. Owns the
 * id generation and aria wiring so individual primitives don't reinvent it.
 *
 * Layout: label above, control, helper-or-error below. Helper and error
 * never stack — error replaces helper.
 */
export function Field({
  label,
  helperText,
  error,
  hideLabel = false,
  required = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy = invalid
    ? errorId
    : helperText
      ? helperId
      : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cn(
          "font-sans text-label text-cream",
          hideLabel && "sr-only",
        )}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-terracotta">
            *
          </span>
        )}
      </label>

      {children({ id, describedBy, invalid })}

      {invalid ? (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="font-sans text-body-sm text-terracotta"
        >
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="font-sans text-body-sm text-cream-muted">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
