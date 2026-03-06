/**
 * CORS helper for Next.js App Router API routes.
 *
 * By default allows any origin. Set the CORS_ALLOWED_ORIGINS environment
 * variable to a comma-separated list of origins to restrict access.
 * Example: CORS_ALLOWED_ORIGINS=http://localhost:3001,https://myapp.com
 */

const DEFAULT_ALLOWED_METHODS = "GET, POST, OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization";

function resolveOrigin(requestOrigin) {
  const allowed = process.env.CORS_ALLOWED_ORIGINS;
  if (!allowed) return "*";

  const list = allowed.split(",").map((o) => o.trim());
  if (list.includes(requestOrigin)) return requestOrigin;
  return list[0]; // fallback to first allowed origin
}

/**
 * Returns CORS headers for a given request.
 * @param {Request} request
 * @returns {Record<string, string>}
 */
export function corsHeaders(request) {
  const origin = request?.headers?.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": resolveOrigin(origin),
    "Access-Control-Allow-Methods": DEFAULT_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Handles an OPTIONS preflight request.
 * @param {Request} request
 * @returns {Response}
 */
export function handlePreflight(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
