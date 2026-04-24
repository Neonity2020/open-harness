export async function convertEventStreamToJsonResponse(response: Response): Promise<Response> {
  const text = await response.text();
  const finalResponse = findFinalResponse(text);

  if (!finalResponse) {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(finalResponse), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function ensureEventStreamContentType(response: Response): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/event-stream; charset=utf-8");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function findFinalResponse(streamText: string): unknown | null {
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;

    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const event = JSON.parse(data) as { type?: string; response?: unknown };
      if (event.type === "response.done" || event.type === "response.completed") {
        return event.response ?? null;
      }
    } catch {
      // Ignore malformed data frames.
    }
  }

  return null;
}
