import { verifyResendWebhook } from "./transport.js";
import {
  BusinessError,
  isBusinessError,
  respond,
  fail,
  sha,
} from "@workspace-agent/dsh-commerce-contracts";
// Separate provider gateway: never shares the DSH owner cookie or Worker token.
export function createInboundHandler({
  secret,
  transport,
  rfq,
  sessionId,
  projectId,
  inbox,
  clock = Date.now,
  allowRemote = false,
}) {
  const windows = new Map();
  return async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/quote-guard-inbound/resend")
        fail("NOT_FOUND", "Unknown ingress", 404);
      if (!secret || !transport || !sessionId || !inbox)
        fail(
          "UNCONFIGURED",
          "Authorized inbound account is not configured",
          503,
        );
      if (req.headers.origin || req.headers["sec-fetch-site"])
        fail("INGRESS_DENIED", "Service ingress only", 403);
      if (
        !allowRemote &&
        !req.socket.encrypted &&
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        )
      )
        fail("TLS_REQUIRED", "Configure a trusted HTTPS reverse proxy", 403);
      const remote = req.socket.remoteAddress,
        window = Math.floor(clock() / 60000);
      if (windows.get(remote)?.window !== window)
        windows.set(remote, { window, n: 0 });
      if (++windows.get(remote).n > 60)
        fail("RATE_LIMIT", "Too many ingress events", 429);
      // Bound the number of independently tracked remote windows.
      if (windows.size > 1024)
        for (const [k, v] of windows)
          if (v.window !== window) windows.delete(k);
      if (windows.size > 1024)
        fail("RATE_LIMIT", "Ingress capacity reached", 429);
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 262144) fail("BODY_TOO_LARGE", "Webhook too large", 413);
        chunks.push(c);
      }
      const proof = verifyResendWebhook(
        Buffer.concat(chunks),
        req.headers,
        secret,
        clock(),
      );
      if (proof.event.type !== "email.received")
        return respond(res, 200, { ok: true, ignored: true });
      const emailId = proof.event.data?.email_id;
      if (typeof emailId !== "string") fail("SOURCE_INVALID");
      const message = await transport.received(emailId);
      if (
        !Array.isArray(message.to) ||
        !message.to.includes(inbox) ||
        typeof message.text !== "string" ||
        !message.text.trim()
      )
        fail(
          "SOURCE_INVALID",
          "Exact inbox and retained plain text are required",
        );
      const rawText = JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId: message.message_id ?? emailId,
      });
      const result = rfq().ingestVerified(sessionId, {
        action: "import",
        requestId: `inbound:${sha(proof.messageId)}`,
        expectedRevision: 0,
        rawText,
        ...(projectId ? { projectId } : {}),
        authorizationEvidence: `Configured inbox ${inbox}; signed provider event ${proof.messageId}; SHA ${proof.sha256}`,
        source: {
          channel: "email",
          accountRef: transport.accountRef,
          externalMessageId: emailId,
          threadId: message.message_id ?? emailId,
          receivedAt: new Date(message.created_at).toISOString(),
          rawEvidenceSha256: sha(rawText),
        },
      });
      respond(res, 200, {
        ok: true,
        id: result.current.id,
        duplicate: result.replayed,
      });
    } catch (e) {
      respond(res, isBusinessError(e) ? e.status : 503, {
        ok: false,
        error: { code: isBusinessError(e) ? e.code : "PROVIDER_UNAVAILABLE" },
      });
    }
  };
}
