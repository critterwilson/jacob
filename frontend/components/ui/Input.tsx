import { type InputHTMLAttributes, type ReactNode, forwardRef } from "react";

import { cn } from "./cn";
import { Field } from "./Field";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  helperText?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
};

const inputBase =
  // 44 px tall — meets the iOS touch-target floor. `text-body` (16 px)
  // also prevents iOS Safari's focus-zoom on input.
  "h-11 w-full rounded border bg-ink-overlay px-3 " +
  "font-sans text-body text-cream placeholder:text-cream-muted " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:shadow-glow-gold focus-visible:border-gold " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    hideLabel,
    required,
    className,
    ...rest
  },
  ref,
) {
  return (
    <Field
      label={label}
      helperText={helperText}
      error={error}
      hideLabel={hideLabel}
      required={required}
    >
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            inputBase,
            invalid ? "border-terracotta" : "border-line",
            className,
          )}
          {...rest}
        />
      )}
    </Field>
  );
});
