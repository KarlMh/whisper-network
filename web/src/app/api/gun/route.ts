import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return new Response('Gun relay — wspr', { status: 200 })
}

export async function PUT(req: NextRequest) {
  return new Response(null, { status: 200 })
}
