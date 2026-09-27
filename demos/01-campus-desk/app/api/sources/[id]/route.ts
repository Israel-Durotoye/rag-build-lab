import { handbook } from "@/lib/handbook";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const source = handbook.sources.find((item) => item.id === id);
  if (!source)
    return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ source, corpusVersion: handbook.version });
}
