import {
  keys,
  text,
  integer,
  hash,
  iso,
  sha,
  dependency,
  fail,
} from "@workspace-agent/dsh-commerce-contracts";
// Bytes stay in DSH attachments. Billing stores only exact references and owner interpretation.
export function createBillingEvidence({ attachments, check }) {
  return {
    async verify(s, ref) {
      check(s, true);
      keys(ref, [
        "attachmentId",
        "name",
        "sha256",
        "bytes",
        "provider",
        "externalEventId",
        "occurredAt",
      ]);
      text(ref.name, "name", 255);
      hash(ref.sha256);
      integer(ref.bytes, "bytes", 1, 262144);
      text(ref.provider, "provider", 200);
      text(ref.externalEventId, "externalEventId", 300);
      if (
        ref.provider !== ref.provider.trim() ||
        ref.externalEventId !== ref.externalEventId.trim()
      )
        fail("EVIDENCE_INVALID");
      iso(ref.occurredAt);
      if (ref.attachmentId !== `sha256:${ref.sha256}`) fail("EVIDENCE_CHANGED");
      let n = 0;
      const chunks = [];
      try {
        for await (const b of dependency(
          attachments,
          "Native Attachments",
        ).readFileStream(
          { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes },
          s.signal,
        )) {
          n += b.length;
          if (n > ref.bytes) fail("EVIDENCE_CHANGED");
          chunks.push(b);
        }
      } catch (e) {
        check(s, true);
        if (
          dependency(attachments, "Native Attachments").isAttachmentError?.(e)
        )
          fail(
            "EVIDENCE_UNAVAILABLE",
            "原生凭据无法读取或校验，请重新选择实际文件。",
          );
        throw e;
      }
      check(s, true);
      if (n !== ref.bytes || sha(Buffer.concat(chunks)) !== ref.sha256)
        fail("EVIDENCE_CHANGED");
      return {
        ...ref,
        byteIntegrity: "verified",
        interpretation: "owner-recorded-not-independent-provider-verification",
        reviewedBy: s.actor,
      };
    },
    async upload(s, input) {
      check(s, true);
      keys(input, ["fileName", "dataBase64"]);
      text(input.fileName, "fileName", 200);
      text(input.dataBase64, "dataBase64", 350000);
      const data = Buffer.from(input.dataBase64, "base64");
      if (
        !data.length ||
        data.length > 262144 ||
        data.toString("base64") !== input.dataBase64
      )
        fail("EVIDENCE_INVALID");
      const ref = await dependency(attachments, "Native Attachments").saveFile({
        data,
        name: input.fileName,
      });
      check(s, true);
      if (
        ref.attachmentId !== `sha256:${sha(data)}` ||
        ref.bytes !== data.length
      )
        fail("EVIDENCE_CHANGED");
      return {
        attachmentId: ref.attachmentId,
        name: text(ref.name, "name", 255),
        sha256: sha(data),
        bytes: data.length,
      };
    },
  };
}
