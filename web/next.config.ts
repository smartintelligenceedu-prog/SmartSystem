import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js defaults Server Action request bodies to 1MB. The register
    // form submits IC document + payment screenshot together (each allowed
    // up to 8MB by validateUploadFile()'s own MAX_UPLOAD_BYTES in
    // src/lib/storage.ts) and sales-orders' payment-proof upload does the
    // same for one file — a real phone-camera photo routinely exceeds 1MB,
    // so the unconfigured default silently 413'd those submissions before
    // the action's own file-size validation ever ran, surfacing as a raw
    // Next.js error page instead of a friendly "file too large" message.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
