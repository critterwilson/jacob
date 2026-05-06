import type { ReactNode } from "react";

import { LegalFooter } from "@/components/legal/LegalFooter";
import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { Card, Heading } from "@/components/ui";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        {/* Symbolic motif + wordmark — quiet hero above the form. */}
        <div className="flex flex-col items-center gap-3 text-gold-soft">
          <LightFromClouds className="h-20 w-auto opacity-90" />
          <Heading level={1} size="md" className="normal-case">
            JACOB
          </Heading>
        </div>

        <Card surface="raised" padding="lg" className="w-full">
          {children}
        </Card>

        <LegalFooter />
      </div>
    </main>
  );
}
