import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function proxy(request: NextRequest) {
  const backendPath = request.nextUrl.pathname;
  if (!backendPath.startsWith('/api/v1/')) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const origin = request.headers.get('origin');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin !== request.nextUrl.origin) {
    return NextResponse.json({ success: false, error: 'Cross-origin request rejected' }, { status: 403 });
  }

  const token = request.cookies.get('scoreyako_access_token')?.value;
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('accept', request.headers.get('accept') || 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const upstream = await fetch(`${BACKEND_URL}${backendPath}${request.nextUrl.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: 'no-store',
  });
  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) responseHeaders.set('content-type', upstreamType);
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;