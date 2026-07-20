const DEFAULT_ORIGIN = "*";

function getAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) {
    return null;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function corsHeaders(requestOrigin = "") {
  const allowed = getAllowedOrigins();
  let origin = DEFAULT_ORIGIN;

  if (allowed) {
    origin = allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || "null";
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function handleOptions(request) {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
