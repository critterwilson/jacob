/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Firebase Hosting. No API routes or server-only Next.js
  // features are used — all dynamic data comes from the Firestore client SDK
  // and the FastAPI backend, so a static HTML/JS bundle is sufficient.
  // See docs/follow-ups/phase-1-deferred.md for migrating to App Hosting (SSR)
  // once firebase apphosting:backends:create has been run for each environment.
  output: "export",
};

export default nextConfig;
