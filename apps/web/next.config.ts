import type { NextConfig } from "next";

const scriptSrc = ["'self'", "'unsafe-inline'", process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  // @qorechain/pqc 0.2.3 verifies in JavaScript. It does not load WebAssembly, so this does not add wasm-unsafe-eval.
  "connect-src 'self' https://evm-testnet.qore.host",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  agentRules: false,
  turbopack: { root: process.cwd() },
  async rewrites() {
    const rest = "https://api-testnet.qore.host";
    return [
      { source: "/qore-rest/cosmos/auth/v1beta1/accounts/:address", destination: `${rest}/cosmos/auth/v1beta1/accounts/:address` },
      { source: "/qore-rest/qorechain/pqc/v1/account/:address", destination: `${rest}/qorechain/pqc/v1/account/:address` },
      { source: "/qore-rest/qorechain/pqc/v1/evm_window/:address", destination: `${rest}/qorechain/pqc/v1/evm_window/:address` },
      { source: "/qore-rest/qorechain/pqc/v1/protocol_features", destination: `${rest}/qorechain/pqc/v1/protocol_features` },
      { source: "/qore-rest/cosmos/bank/v1beta1/balances/:address", destination: `${rest}/cosmos/bank/v1beta1/balances/:address` },
      {
        source: "/qore-rest/cosmos/bank/v1beta1/balances/:address/by_denom",
        destination: `${rest}/cosmos/bank/v1beta1/balances/:address/by_denom`,
      },
      { source: "/qore-rpc", destination: "https://rpc-testnet.qore.host/" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
