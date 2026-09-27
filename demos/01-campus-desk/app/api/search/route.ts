import { handbook } from "@/lib/handbook";
import { ask } from "@/lib/pipeline";
import { capabilities, providers } from "@/lib/providers";
import type { RetrievalMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function failure(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return failure("Send a JSON request.", 415);
  // Read a bounded body, including requests without a Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) return failure("Enter a question.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let body: unknown;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return failure("Request is too large.", 413);
      }
      chunks.push(part.value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return failure("Send a valid JSON object.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return failure("Send a valid JSON object.", 400);
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["question", "mode", "previousQuestion"].includes(key),
    )
  )
    return failure("Unsupported search option.", 400);
  if (
    typeof input.question !== "string" ||
    !input.question.trim() ||
    input.question.length > 4000
  )
    return failure("Enter a question between 1 and 4,000 characters.", 400);
  if (
    input.previousQuestion !== undefined &&
    (typeof input.previousQuestion !== "string" ||
      input.previousQuestion.length > 4000)
  )
    return failure("Invalid previous question.", 400);
  const mode = input.mode ?? "keyword";
  if (
    typeof mode !== "string" ||
    !capabilities().modes.includes(mode as RetrievalMode)
  )
    return failure("This retrieval mode is not available.", 400);
  try {
    const result = await ask(handbook, input.question, {
      mode: mode as RetrievalMode,
      previousQuestion: input.previousQuestion as string | undefined,
      ...providers(),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure(
      "Search is unavailable. Try keyword search or check the model configuration.",
      503,
    );
  }
}
