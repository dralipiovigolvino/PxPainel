import { NextResponse, type NextRequest } from "next/server";
import { getNeonAuth } from "@/lib/auth/neon-auth";
import { buildLoginPath, isPublicPath, LOGIN_PATH } from "@/lib/auth/redirects";

/**
 * Verificação otimista e renovação de sessão (único ponto de renovação).
 * Não substitui requireUser() nas páginas e ações, nem o RLS no banco.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const auth = getNeonAuth();
  // Sem configuração: nada é liberado; o login exibe a indisponibilidade.
  if (!auth) return NextResponse.redirect(new URL(buildLoginPath(pathname, search), request.url));

  const response = await auth.middleware({ loginUrl: LOGIN_PATH })(request);

  // O SDK redireciona para /login repassando só a query; troca pelo destino
  // completo e validado (?next=), preservando os cookies que ele definiu.
  const location = response.headers.get("location");
  if (location && new URL(location, request.url).pathname === LOGIN_PATH) {
    const redirect = NextResponse.redirect(new URL(buildLoginPath(pathname, search), request.url));
    for (const cookie of response.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // Todas as rotas, exceto arquivos estáticos do Next e imagens.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
