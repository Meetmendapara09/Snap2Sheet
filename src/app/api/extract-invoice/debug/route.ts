import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  // Development-only debug endpoint. Enable by setting ENABLE_DEBUG=true in .env
  if (process.env.ENABLE_DEBUG !== "true") {
    return NextResponse.json({ error: "Debug endpoint disabled" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { image, apiKey, model } = body;

    if (!image) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }

    const effectiveApiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY;
    if (!effectiveApiKey) {
      return NextResponse.json({ error: "No OpenRouter API key configured on server" }, { status: 400 });
    }

    const chosenModel = typeof model === "string" && model.trim().length > 0 ? model.trim() : (process.env.DEFAULT_MODEL ?? "openai/gpt-oss-20b:free");

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveApiKey}`,
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: [
          { role: "system", content: "DEBUG: return raw response" },
          {
            role: "user",
            content: [
              { type: "text", text: "Return the raw JSON response without modification." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0,
      }),
    });

    let text;
    try {
      text = await resp.text();
    } catch {
      return NextResponse.json({ error: "Failed to read OpenRouter response" }, { status: 502 });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Return raw text if not JSON
      return NextResponse.json({ ok: true, rawText: text }, { status: 200 });
    }

    return NextResponse.json({ ok: true, raw: parsed }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
