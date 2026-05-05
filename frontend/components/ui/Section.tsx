import { type ReactNode } from "react";

import { Card, type CardSurface } from "./Card";
import { Eyebrow } from "./Eyebrow";
import { Heading } from "./Heading";
import { cn } from "./cn";

type SectionTone = "default" | "danger";

type SectionProps = {
  /** Optional eyebrow above the title. */
  eyebrow?: ReactNode;
  /** Section title. Rendered as h2 / display-sm. */
  title: ReactNode;
  /** Optional description below the title, body-sm cream-muted. */
  description?: ReactNode;
  /**
   * Visual tone. "danger" tints the title terracotta and uses a
   * terracotta line border. Use only for irreversible / destructive
   * sections (archive, delete account).
   */
  tone?: SectionTone;
  /**
   * Whether to wrap in a Card. Default true. Set false for bare
   * section-header-plus-body where the body brings its own chrome.
   */
  card?: boolean;
  surface?: CardSurface;
  className?: string;
  children: ReactNode;
};

const titleToneClass: Record<SectionTone, string> = {
  default: "",
  danger: "text-terracotta",
};

const cardToneClass: Record<SectionTone, string> = {
  default: "",
  danger: "border-terracotta/60",
};

/**
 * Settings-page section. Composes Eyebrow + Heading + description with
 * a body slot, optionally wrapped in a Card. Lets surface code stop
 * re-implementing the same border-and-padding chrome around every
 * settings group.
 */
export function Section({
  eyebrow,
  title,
  description,
  tone = "default",
  card = true,
  surface = "raised",
  className,
  children,
}: SectionProps) {
  const header = (
    <header className="space-y-1">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Heading
        level={2}
        size="sm"
        className={titleToneClass[tone]}
      >
        {title}
      </Heading>
      {description && (
        <p className="text-body-sm text-cream-muted">{description}</p>
      )}
    </header>
  );

  const body = <div className="space-y-4">{children}</div>;

  if (!card) {
    return (
      <section className={cn("space-y-4", className)}>
        {header}
        {body}
      </section>
    );
  }

  return (
    <Card
      surface={surface}
      padding="lg"
      className={cn("space-y-5", cardToneClass[tone], className)}
    >
      {header}
      {body}
    </Card>
  );
}
