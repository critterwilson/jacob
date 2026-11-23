import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="mb-8 text-center text-2xl font-semibold">JACOB</h1>
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
