export async function GET() {
  const hint = process.env.DEMO_AUTH_TOKEN ?? null;
  return Response.json({ hint });
}
