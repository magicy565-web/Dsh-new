import { randomUUID } from "node:crypto";
import {
  createAccess,
  checkScope,
  keys,
  id,
  text,
  integer,
  hash,
  iso,
  sha,
  fail,
  dependency,
} from "@workspace-agent/dsh-commerce-contracts";
import {
  source,
  requirements,
  extraction,
  missing,
  transition,
} from "@workspace-agent/domain-rfq";
import {
  parseCsv,
  normalizeInquiryRow,
  inquiryRowSourceHash,
} from "@workspace/domain-inquiry-recovery";
export function createRfqService({
  store,
  registry,
  attachments = () => null,
  erp = () => null,
  commerce = () => null,
  clock = Date.now,
  retentionDays = 30,
}) {
  integer(retentionDays, "retentionDays", 1, 365);
  const access = createAccess(registry);
  const check = (s) => checkScope(s, registry);
  function visible(record, { raw = false } = {}) {
    const { rawText, candidates, drafts, ...r } = record;
    const expired =
      Date.parse(record.retainUntil) <= clock() || rawText === null;
    return {
      ...r,
      sourceAvailability: expired ? "retention_expired" : "available",
      candidates: (candidates ?? []).map((c) =>
        expired
          ? {
              ...c,
              fieldEvidence: Object.fromEntries(
                Object.entries(c.fieldEvidence).map(([k, v]) => [
                  k,
                  { start: v.start, end: v.end },
                ]),
              ),
            }
          : c,
      ),
      drafts: (drafts ?? []).map(({ content, ...d }) =>
        expired ? { ...d, contentUnavailable: true } : { ...d, content },
      ),
      ...(raw && !expired ? { rawText } : {}),
      contentRole: "untrusted-business-data",
      channels: {
        email: "UNCONFIGURED",
        whatsapp: "UNCONFIGURED",
        import: "owner-import",
      },
    };
  }
  function read(scope, input = {}) {
    check(scope);
    keys(input, ["id", "projectId", "afterId", "limit", "includeRaw"]);
    if (input.projectId) project(scope, input.projectId);
    if (input.id) {
      const r = store.get(scope.workspaceId, id(input.id));
      if (input.projectId && r.projectId !== input.projectId) fail("NOT_FOUND");
      return visible(r, { raw: input.includeRaw === true });
    }
    const page = store.list(
      scope.workspaceId,
      input.projectId,
      input.afterId ?? "",
      integer(input.limit ?? 50, "limit", 1, 100),
    );
    check(scope);
    return {
      ...page,
      items: page.items.map((r) => {
        const { candidates, drafts, authorizationEvidence, ...v } = visible(r);
        return {
          ...v,
          candidateCount: candidates.length,
          draftCount: drafts.length,
        };
      }),
      workspaceId: scope.workspaceId,
    };
  }
  function project(scope, projectId) {
    id(projectId, "projectId");
    const state = dependency(commerce, "Commerce Network").state(
      scope.sessionId,
      projectId,
    );
    if (
      state.workspaceId !== scope.workspaceId ||
      state.projectId !== projectId
    )
      fail("PROJECT_SCOPE");
  }
  function mutate(scope, input, verifiedSource = false) {
    check(scope);
    id(input.requestId, "requestId");
    integer(input.expectedRevision, "expectedRevision");
    const modelActions = ["propose_extraction", "propose_reply"];
    if (scope.kind !== "owner" && !modelActions.includes(input.action))
      fail("OWNER_REQUIRED");
    const common = ["action", "requestId", "expectedRevision", "id"];
    return store.write(
      scope,
      input,
      () => {
        if (input.action === "import") {
          keys(input, [
            ...common,
            "source",
            "rawText",
            "projectId",
            "authorizationEvidence",
            "productRef",
          ]);
          if (input.expectedRevision !== 0) fail("REVISION_CONFLICT");
          source(input.source, input.rawText);
          text(input.authorizationEvidence, "authorizationEvidence");
          if (input.source.channel !== "import" && !verifiedSource)
            fail(
              "UNCONFIGURED",
              "Live channels require their verified ingress adapter",
            );
          if (input.projectId) project(scope, input.projectId);
          const prior = store.sourceMatch(scope.workspaceId, input.source);
          if (prior) {
            if (
              prior.source.rawEvidenceSha256 !== input.source.rawEvidenceSha256
            )
              fail("SOURCE_CONFLICT");
            return prior;
          }
          if (input.productRef) {
            keys(input.productRef, ["id", "revision", "skuId"]);
            id(input.productRef.id);
            integer(input.productRef.revision, "revision", 1);
            if (input.productRef.skuId) id(input.productRef.skuId);
          }
          return {
            id: `rfq_${randomUUID()}`,
            workspaceId: scope.workspaceId,
            projectId: input.projectId ?? null,
            productRef: input.productRef ?? null,
            source: input.source,
            rawText: input.rawText,
            authorizationEvidence: input.authorizationEvidence,
            sourceTrust: verifiedSource
              ? "provider-signed-retrieved"
              : "owner-import-not-independent-verification",
            requirements: {},
            missingFields: missing({}),
            evidenceRefs: [`sha256:${input.source.rawEvidenceSha256}`],
            status: "received",
            revision: 1,
            candidates: [],
            drafts: [],
            buyerRef: null,
            contactPermission: { status: "unknown" },
            retainUntil: new Date(
              clock() + retentionDays * 864e5,
            ).toISOString(),
          };
        }
        const r = store.get(scope.workspaceId, id(input.id));
        if (r.revision !== input.expectedRevision) fail("REVISION_CONFLICT");
        if (r.projectId) project(scope, r.projectId);
        if (input.action === "propose_extraction") {
          keys(input, [...common, "extraction"]);
          if (r.status === "closed") fail("RFQ_CLOSED");
          if (r.rawText === null || Date.parse(r.retainUntil) <= clock())
            fail("SOURCE_UNAVAILABLE");
          const c = extraction(
            input.extraction,
            r.rawText,
            r.source.rawEvidenceSha256,
          );
          if (r.candidates.length >= 100) fail("CAPACITY_LIMIT");
          r.candidates.push({
            ...c,
            id: `ext_${randomUUID()}`,
            at: new Date(clock()).toISOString(),
            revision: r.revision + 1,
            actor: scope.actor,
            status: "proposed",
          });
        } else if (input.action === "propose_reply") {
          keys(input, [...common, "content", "sourceSha256"]);
          if (r.status === "closed") fail("RFQ_CLOSED");
          if (
            input.sourceSha256 !== r.source.rawEvidenceSha256 ||
            Date.parse(r.retainUntil) <= clock()
          )
            fail("SOURCE_CHANGED");
          if (r.drafts.length >= 100) fail("CAPACITY_LIMIT");
          const content = text(input.content, "content", 16000);
          r.drafts.push({
            id: `draft_${randomUUID()}`,
            content,
            sha256: sha(content),
            sourceSha256: input.sourceSha256,
            actor: scope.actor,
            at: new Date(clock()).toISOString(),
            sent: false,
            approved: false,
          });
        } else if (input.action === "review") {
          keys(input, [
            ...common,
            "candidateId",
            "status",
            "buyerRef",
            "identityEvidence",
            "contactPermission",
          ]);
          const candidate = r.candidates.find(
            (c) => c.id === input.candidateId,
          );
          if (!candidate) fail("EXTRACTION_REQUIRED");
          if (Date.parse(r.retainUntil) <= clock()) fail("SOURCE_UNAVAILABLE");
          r.requirements = requirements(candidate.requirements);
          r.missingFields = missing(r.requirements);
          if (
            ["qualified", "ready_for_quote"].includes(input.status) &&
            r.missingFields.length
          )
            fail("RFQ_MISSING_FIELDS");
          r.status = transition(r.status, input.status);
          r.review = {
            candidateId: candidate.id,
            actor: scope.actor,
            at: new Date(clock()).toISOString(),
            sourceSha256: r.source.rawEvidenceSha256,
          };
          if (input.buyerRef) {
            const b = dependency(erp, "Mini ERP").buyer(
              scope,
              id(input.buyerRef),
            );
            r.buyerRef = b.id;
            r.identityEvidence = text(
              input.identityEvidence,
              "identityEvidence",
            );
          }
          if (input.contactPermission) {
            keys(input.contactPermission, [
              "status",
              "evidence",
              "recipient",
              "validUntil",
            ]);
            if (
              !["allowed", "opted_out", "unknown"].includes(
                input.contactPermission.status,
              )
            )
              fail("INPUT");
            text(input.contactPermission.evidence, "evidence");
            if (input.contactPermission.status === "allowed") {
              if (!r.buyerRef) fail("BUYER_REQUIRED");
              const b = dependency(erp, "Mini ERP").buyer(scope, r.buyerRef);
              if (input.contactPermission.recipient !== b.email || !b.email)
                fail("RECIPIENT_MISMATCH");
              iso(input.contactPermission.validUntil);
            }
            r.contactPermission = {
              ...input.contactPermission,
              reviewedBy: scope.actor,
            };
          }
        } else if (input.action === "assign_project") {
          keys(input, [...common, "projectId"]);
          project(scope, input.projectId);
          r.projectId = input.projectId;
        } else if (input.action === "revoke_contact") {
          keys(input, [...common, "evidence"]);
          r.contactPermission = {
            status: "opted_out",
            evidence: text(input.evidence, "evidence"),
            reviewedBy: scope.actor,
          };
        } else if (input.action === "close") {
          keys(input, common);
          r.status = transition(r.status, "closed");
        } else if (input.action === "purge_source") {
          keys(input, common);
          r.rawText = null;
          r.candidates = r.candidates.map((c) => ({
            ...c,
            fieldEvidence: Object.fromEntries(
              Object.entries(c.fieldEvidence).map(([k, v]) => [
                k,
                { start: v.start, end: v.end },
              ]),
            ),
          }));
          r.drafts = r.drafts.map(({ content, ...d }) => d);
          r.status = "closed";
        } else fail("ACTION_DENIED");
        r.revision++;
        check(scope);
        return r;
      },
      clock(),
    );
  }
  const result = (response) => ({
    ...response,
    current: visible(response.current),
  });
  return {
    purgeExpired() {
      return store.purgeExpired(clock());
    },
    ingestVerified(sessionId, input) {
      return result(mutate(access.owner(sessionId), input, true));
    },
    read,
    quoteContext(scope, rfqId) {
      check(scope);
      const r = store.get(scope.workspaceId, id(rfqId));
      if (r.projectId) project(scope, r.projectId);
      if (
        r.status !== "ready_for_quote" ||
        !r.review ||
        r.missingFields.length ||
        !r.buyerRef ||
        !r.identityEvidence ||
        r.contactPermission.status !== "allowed" ||
        Date.parse(r.contactPermission.validUntil) <= clock() ||
        r.rawText === null ||
        Date.parse(r.retainUntil) <= clock()
      )
        fail(
          "RFQ_NOT_AUTHORIZED",
          "RFQ needs source, field review, buyer and current contact permission",
        );
      return visible(r);
    },
    toolRead(input, execution) {
      return read(access.tool(execution), input);
    },
    toolWrite(action, input, execution) {
      if (!["propose_extraction", "propose_reply"].includes(action))
        fail("OWNER_REQUIRED");
      keys(
        input,
        action === "propose_reply"
          ? ["requestId", "expectedRevision", "id", "content", "sourceSha256"]
          : ["requestId", "expectedRevision", "id", "extraction"],
      );
      return result(mutate(access.tool(execution), { ...input, action }));
    },
    ownerWrite(sessionId, input) {
      return result(mutate(access.owner(sessionId), input));
    },
    async importAttachment(sessionId, input, recheck = async () => {}) {
      keys(input, [
        "attachment",
        "sha256",
        "bytes",
        "format",
        "rowIndex",
        "accountRef",
        "requestId",
        "expectedRevision",
        "projectId",
        "authorizationEvidence",
        "receivedAt",
      ]);
      const scope = access.owner(sessionId, recheck.sync);
      hash(input.sha256);
      integer(input.bytes, "bytes", 1, 65536);
      integer(input.rowIndex, "rowIndex", 0, 9999);
      keys(input.attachment, ["attachmentId", "bytes"]);
      if (
        input.attachment.attachmentId !== `sha256:${input.sha256}` ||
        input.attachment.bytes !== input.bytes
      )
        fail("SOURCE_CHANGED");
      const chunks = [];
      let n = 0;
      for await (const chunk of dependency(
        attachments,
        "Native Attachment",
      ).readFileStream(input.attachment, scope.signal)) {
        n += chunk.length;
        if (n > input.bytes) fail("SOURCE_CHANGED");
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (n !== input.bytes || sha(bytes) !== input.sha256)
        fail("SOURCE_CHANGED");
      let rows;
      try {
        const value = new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/^\uFEFF/, "");
        rows =
          input.format === "csv"
            ? parseCsv(value)
            : input.format === "json"
              ? JSON.parse(value).inquiries
              : null;
      } catch {
        fail("SOURCE_INVALID");
      }
      if (!Array.isArray(rows) || !rows[input.rowIndex]) fail("SOURCE_INVALID");
      const row = rows[input.rowIndex];
      normalizeInquiryRow(row);
      const rowHash = inquiryRowSourceHash(row),
        rawText = JSON.stringify(row);
      await recheck();
      check(scope);
      return result(
        mutate(scope, {
          action: "import",
          requestId: input.requestId,
          expectedRevision: input.expectedRevision,
          rawText,
          projectId: input.projectId,
          authorizationEvidence: input.authorizationEvidence,
          source: {
            channel: "import",
            accountRef: text(input.accountRef, "accountRef", 300),
            externalMessageId: `${input.sha256}:${input.rowIndex}:${rowHash}`,
            receivedAt: iso(input.receivedAt),
            rawEvidenceSha256: sha(rawText),
          },
        }),
      );
    },
    async http(method, action, body, recheck) {
      const { sessionId, ...input } = body;
      const scope = access.owner(sessionId, recheck.sync);
      if (method === "GET" && action === "read") {
        if (input.limit) input.limit = Number(input.limit);
        if (input.includeRaw !== undefined)
          input.includeRaw = input.includeRaw === "true";
        return read(scope, input);
      }
      if (method === "POST" && action === "import-attachment")
        return this.importAttachment(sessionId, input, recheck);
      if (method === "POST" && action === "command") {
        await recheck();
        return result(mutate(scope, input));
      }
      fail("NOT_FOUND", "Unknown RFQ endpoint", 404);
    },
    close() {
      access.close();
      store.close();
    },
  };
}
