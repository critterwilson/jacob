/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // TODO (before T07): static export cannot serve dynamic routes such as
  // /groups/[gid]. Migrate to Firebase App Hosting for full Next.js SSR.
  // https://firebase.google.com/docs/app-hosting
};

export default nextConfig;
