import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isLoginPage = path.startsWith("/login");
  const isRegisterPage = path.startsWith("/register");
  const isAuth = path.startsWith("/api/auth");
  const isHealth = path.startsWith("/api/health");
  const isRegisterApi = path.startsWith("/api/register");
  const isWhatsAppIntegration = path.startsWith("/api/integrations/whatsapp");

  if (isAuth || isHealth || isRegisterApi || isWhatsAppIntegration) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !isLoginPage && !isRegisterPage) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isLoggedIn && (isLoginPage || isRegisterPage)) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
