import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Endereços antigos de Finanças (favoritos e links salvos) levam às telas atuais.
  async redirects() {
    return [
      { source: "/financas/visao", destination: "/financas", permanent: false },
      { source: "/financas/parcelamentos", destination: "/financas/recorrencias", permanent: false },
      { source: "/financas/cartoes", destination: "/financas/formas-de-pagamento", permanent: false },
      { source: "/financas/cartoes/:path*", destination: "/financas/formas-de-pagamento", permanent: false },
    ];
  },
};

export default nextConfig;
