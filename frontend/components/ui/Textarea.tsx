import {
  type ReactNode,
  type TextareaHTMLAttributes,
  forwardRef,
} from "react";

import { cn } from "./cn";
import { Field } from "./Field";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  helperText?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
};

const textareaBase =
  "min-h-[6rem] w-full rounded border bg-ink-overlay px-3 py-2 " +
  "font-sans text-body text-cream placeholder:text-cream-dim " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:shadow-glow-gold focus-visible:border-gold " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      helperText,
      error,
      hideLabel,
      required,
      className,
      rows = 4,
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
          <textarea
            ref={ref}
            id={id}
            rows={rows}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              textareaBase,
              invalid ? "border-terracotta" : "border-line",
              className,
            )}
            {...rest}
          />
        )}
      </Field>
    );
  },
);
