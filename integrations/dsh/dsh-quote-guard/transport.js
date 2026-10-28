import { createHmac, timingSafeEqual } from "node:crypto";
import { fail, text, sha } from "@workspace-agent/dsh-commerce-contracts";
export function createResendTransport({
  apiKey,
  from,
  accountRef,
  fetchImpl = fetch,
  clock = Date.now,
}) {
  if (!apiKey || !from || !accountRef) return null;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from))
    fail("CONFIG", "Use an explicitly verified sender email");
  const call = async (path, options = {}) => {
    const response = await fetchImpl(`https://api.resend.com${path}`, {
      ...options,
      redirect: "error",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...options.headers,
      },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 262144) fail("PROVIDER_RESPONSE_INVALID");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      fail("PROVIDER_RESPONSE_INVALID");
    }
    return { response, data, responseSha256: sha(raw) };
  };
  return {
    accountRef,
    from,
    provider: "resend",
    async send(intent, { signal } = {}) {
      const result = await call("/emails", {
        method: "POST",
        signal,
        headers: {
          "idempotency-key": sha(
            `${accountRef}:${intent.quoteId}:${intent.version}:${intent.requestId}`,
          ),
        },
        body: JSON.stringify({
          from,
          to: [intent.recipient],
          subject: intent.subject,
          text: intent.text,
          tags: [
            { name: "quote_id", value: intent.quoteId },
            { name: "quote_version", value: String(intent.version) },
          ],
        }),
      });
      if (result.response.ok && typeof result.data.id === "string")
        return {
          status: "sent",
          providerMessageId: result.data.id,
          provider: accountRef,
          at: new Date(clock()).toISOString(),
          responseSha256: result.responseSha256,
        };
      if ([400, 401, 403, 422].includes(result.response.status))
        return { status: "failed", definitive: true };
      return { status: "unknown" };
    },
    async lookup(intent, result) {
      // Resend has no lookup by idempotency key. If the initial response was lost,
      // wait for verified provider evidence; never invent a new key or auto-resend.
      if (!result?.providerMessageId) return { status: "unknown" };
      const r = await call(
        `/emails/${encodeURIComponent(result.providerMessageId)}`,
      );
      if (
        !r.response.ok ||
        r.data.id !== result.providerMessageId ||
        r.data.subject !== intent.subject ||
        r.data.text !== intent.text ||
        !Array.isArray(r.data.to) ||
        r.data.to.length !== 1 ||
        r.data.to[0] !== intent.recipient ||
        r.data.from !== from
      )
        return { status: "unknown" };
      return {
        status: "sent",
        providerMessageId: r.data.id,
        provider: accountRef,
        at: r.data.created_at,
        responseSha256: r.responseSha256,
      };
    },
    async received(emailId) {
      const r = await call(
        `/emails/receiving/${encodeURIComponent(text(emailId, "emailId", 200))}`,
      );
      if (!r.response.ok || r.data.id !== emailId)
        fail("PROVIDER_RESPONSE_INVALID");
      return r.data;
    },
  };
}
export function verifyResendWebhook(raw, headers, secret, now = Date.now()) {
  if (!secret)
    fail("UNCONFIGURED", "Webhook signing secret is not configured", 503);
  const messageId = headers["svix-id"],
    timestamp = headers["svix-timestamp"],
    signatures = headers["svix-signature"];
  if (
    typeof messageId !== "string" ||
    typeof timestamp !== "string" ||
    !/^[0-9]+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    typeof signatures !== "string"
  )
    fail("WEBHOOK_SIGNATURE", "Invalid signed event", 401);
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length < 16) fail("CONFIG");
  const expected = createHmac("sha256", key)
    .update(`${messageId}.${timestamp}.`)
    .update(raw)
    .digest();
  const good = signatures.split(" ").some((part) => {
    if (!part.startsWith("v1,")) return false;
    const value = Buffer.from(part.slice(3), "base64");
    return value.length === expected.length && timingSafeEqual(expected, value);
  });
  if (!good) fail("WEBHOOK_SIGNATURE", "Invalid signed event", 401);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    fail("INPUT");
  }
  return { event, messageId, sha256: sha(raw) };
}
