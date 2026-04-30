import { NextResponse } from 'next/server';

const PASSWORD = '6910';
const COOKIE   = 'fvc_auth';

export function middleware(req) {
  const { pathname } = req.nextUrl;

  // Allow the login page and its POST through unconditionally
  if (pathname === '/login') return NextResponse.next();

  // Check for valid auth cookie
  const cookie = req.cookies.get(COOKIE);
  if (cookie?.value === PASSWORD) return NextResponse.next();

  // Not authenticated — redirect to login
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};
