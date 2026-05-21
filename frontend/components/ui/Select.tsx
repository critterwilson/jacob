import {
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
} from "react";

import { cn } from "./cn";
import { Field } from "./Field";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  helperText?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
};

const selectBase =
  // 44 px tall — matches Input. iOS native select is its own UI either way.
  "h-11 w-full appearance-none rounded border bg-ink-overlay pl-3 pr-9 " +
  "font-sans text-body text-cream " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:shadow-glow-gold focus-visible:border-gold " +
  "disabled:cursor-not-allowed disabled:opacity-60";

// Custom chevron rendered as a background SVG so the control matches the
// rest of the form chrome. Tints to gold-soft.
const chevron =
  "bg-no-repeat bg-[length:14px] bg-[position:right_0.75rem_center] " +
  "bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2214%22%20height=%2214%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23D9BE7C%22%20stroke-width=%221.75%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><polyline%20points=%226%209%2012%2015%2018%209%22/></svg>')]";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    helperText,
    error,
    hideLabel,
    required,
    className,
    children,
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
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            selectBase,
            chevron,
            invalid ? "border-terracotta" : "border-line",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
});
