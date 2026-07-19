// _shared/twOcr.ts — TWSE BSR CAPTCHA OCR via Lovable AI Gateway (vision)
// 回傳 5 碼英數字（大寫），失敗回 null。
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const MODEL = "google/gemini-2.5-flash-lite";

export async function ocrTwseCaptcha(pngBytes: Uint8Array): Promise<string | null> {
  if (!LOVABLE_API_KEY) return null;
  const b64 = base64Encode(pngBytes);
  const dataUrl = `data:image/png;base64,${b64}`;
  const body = {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "The image is a TWSE CAPTCHA showing exactly 5 characters (uppercase A-Z and digits 0-9). " +
              "Return ONLY those 5 characters, no punctuation, no spaces, no explanation.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 12,
  };
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const raw = String(j?.choices?.[0]?.message?.content || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    return raw.length === 5 ? raw : null;
  } catch {
    return null;
  }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(bin);
}
