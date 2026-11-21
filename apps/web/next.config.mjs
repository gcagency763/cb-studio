/** @type {import('next').NextConfig} */
const nextConfig = {
  // uploads grandes (aula de 2 h) e renders longos passam pelo proxy do site até a API
  experimental: { proxyTimeout: 15 * 60 * 1000 },
  async rewrites() {
    const api = process.env.API_URL ?? "http://localhost:4000";
    return [
      { source: "/api/:path*", destination: `${api}/v1/:path*` },
      { source: "/storage/:path*", destination: `${api}/storage/:path*` },
    ];
  },
};
export default nextConfig;
