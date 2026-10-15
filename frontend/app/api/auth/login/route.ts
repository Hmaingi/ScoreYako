import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const upstream = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const result = await upstream.json();
    if (!upstream.ok) return NextResponse.json(result, { status: upstream.status });

    const token = result.data?.access_token;
    if (!token) return NextResponse.json({ success: false, error: 'Sign-in failed' }, { status: 502 });

    const response = NextResponse.json({ success: true, data: { user: result.data.user } });
    response.cookies.set('scoreyako_access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch {
    return NextResponse.json({ success: false, error: 'Unable to sign in' }, { status: 502 });
  }
}