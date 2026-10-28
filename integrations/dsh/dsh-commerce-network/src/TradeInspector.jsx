import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "./Inspector.jsx";
import { requestId } from "./api.mjs";
import { money, STATUSES } from "./model.mjs";
export async function tradeApi(path, { body, signal } = {}) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  if (raw.length > 4 * 1024 * 1024) throw Error("返回内容过大");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Error("插件未返回有效数据");
  }
  if (!r.ok || !data.ok) {
    const e = new Error(
      `${data.error?.code || r.status}：${data.error?.message || "操作未完成"}`,
    );
    e.code = data.error?.code;
    e.status = r.status;
    throw e;
  }
  return data.data;
}
function useRead(url) {
  const [state, setState] = useState({ url: null, data: null, error: null }),
    [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    const c = new AbortController();
    setState({ url, data: null, error: null });
    tradeApi(url, { signal: c.signal }).then(
      (data) => {
        if (active) setState({ url, data, error: null });
      },
      (e) => {
        if (active && e.name !== "AbortError")
          setState({ url, data: null, error: e.message });
      },
    );
    return () => {
      active = false;
      c.abort();
    };
  }, [url, attempt]);
  return {
    ...(state.url === url ? state : { data: null, error: null }),
    reload: () => retry((n) => n + 1),
  };
}
function Receipt({ data }) {
  return (
    <div className="cn-trade-receipt">
      <b>当前状态：{STATUSES[data.status] || data.status}</b>
      <span>修订 {data.revision}</span>
      {data.source && (
        <>
          <span>
            来源：{data.source.channel} · {data.source.externalMessageId}
          </span>
          <code>{data.source.rawEvidenceSha256}</code>
        </>
      )}
    </div>
  );
}
export function TradeInspector({
  node,
  sessionId,
  workspaceId,
  onClose,
  onAsk,
  onRefresh,
}) {
  const [dialog, setDialog] = useState(null);
  const id = node.refId,
    kind = node.kind;
  return (
    <>
      <aside className="cn-inspector" aria-label="交易记录详情">
        <header>
          <strong>{node.title}</strong>
          <button className="cn-button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="cn-inspector-scroll">
          <Receipt data={node.tradeRecord} />
          <p>数据归属：{node.info.authority}。此卡片只展示原始记录。</p>
          {kind === "rfq" && (
            <>
              <p>
                待补字段：
                {node.tradeRecord.missingFields.join("、") ||
                  "无；仍须审核来源和联系许可"}
              </p>
              <button
                className="cn-button cn-primary"
                onClick={() => setDialog("rfq")}
              >
                核对来源与候选
              </button>
              <button className="cn-button" onClick={() => setDialog("policy")}>
                审核报价政策
              </button>
            </>
          )}
          {kind === "quote" && (
            <button
              className="cn-button cn-primary"
              onClick={() => setDialog("quote")}
            >
              审阅报价与发送回执
            </button>
          )}
          {kind === "sample" && (
            <button className="cn-button" onClick={() => setDialog("sample")}>
              查看样品与凭据
            </button>
          )}
          {kind === "erp_order" && (
            <p>订单确认不代表付款或发货。库存和订单操作仍由 ERP 独立处理。</p>
          )}
          <button
            className="cn-text-button"
            onClick={() =>
              onAsk(
                node,
                `请读取当前 ${kind} 记录 ${id} 的来源、缺口及下一步。在当前会话准备候选，不替我审批或发送。`,
              )
            }
          >
            在当前对话继续
          </button>
        </div>
      </aside>
      {dialog === "rfq" && (
        <RfqReview
          sessionId={sessionId}
          workspaceId={workspaceId}
          id={id}
          onClose={() => setDialog(null)}
          onRefresh={onRefresh}
        />
      )}
      {dialog === "policy" && (
        <PolicyReview
          sessionId={sessionId}
          workspaceId={workspaceId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "quote" && (
        <QuoteReview
          sessionId={sessionId}
          quoteId={id}
          onClose={() => setDialog(null)}
          onRefresh={onRefresh}
        />
      )}
      {dialog === "sample" && (
        <SampleReview
          sessionId={sessionId}
          id={id}
          onClose={() => setDialog(null)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
export function QuoteReview({ sessionId, quoteId, onClose, onRefresh }) {
  const url = `/quote-guard-api/read?${new URLSearchParams({ sessionId, quoteId })}`,
    { data, error, reload } = useRead(url);
  const [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(null),
    [providerId, setProviderId] = useState(""),
    [replyId, setReplyId] = useState(""),
    [acceptance, setAcceptance] = useState("");
  const active = useRef(true),
    scope = useRef("");
  const scopeKey = `${sessionId}:${quoteId}`;
  scope.current = scopeKey;
  useEffect(() => {
    active.current = true;
    setPreview(null);
    setFailure(null);
    return () => {
      active.current = false;
    };
  }, [scopeKey]);
  const cacheKey = `dsh:quote-attempt:${scopeKey}`;
  async function action(name, extra = {}) {
    if (busy || !data) return;
    setBusy(true);
    setFailure(null);
    const started = scopeKey;
    let body = {
        sessionId,
        quoteId,
        version: data.version,
        expectedRevision: data.revision,
        requestId: requestId(),
        ...extra,
      },
      path = `/quote-guard-api/${name}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached) {
        if (name !== "retry")
          throw Error("上次提交结果待核对，请先核对上次提交。");
        body = cached.body;
        path = cached.path;
      } else if (name === "retry") throw Error("没有待核对的提交");
      sessionStorage.setItem(cacheKey, JSON.stringify({ body, path }));
      const result = await tradeApi(path, { body });
      sessionStorage.removeItem(cacheKey);
      if (active.current && scope.current === started) {
        setPreview(null);
        reload();
        onRefresh?.();
      }
      return result;
    } catch (e) {
      if (e.status && e.status < 500) sessionStorage.removeItem(cacheKey);
      if (active.current && scope.current === started) setFailure(e.message);
    } finally {
      if (active.current && scope.current === started) setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    setFailure(null);
    const started = scopeKey;
    try {
      const p = await tradeApi(
        `/quote-guard-api/review?${new URLSearchParams({ sessionId, quoteId })}`,
      );
      if (active.current && scope.current === started) setPreview(p);
    } catch (e) {
      if (active.current && scope.current === started) setFailure(e.message);
    } finally {
      if (active.current && scope.current === started) setBusy(false);
    }
  }
  async function acceptReply() {
    try {
      const reply = await tradeApi(
        `/rfq-desk-api/read?${new URLSearchParams({ sessionId, id: replyId, includeRaw: "true" })}`,
      );
      const start = reply.rawText?.indexOf(acceptance) ?? -1;
      if (start < 0 || !acceptance)
        throw Error("同意内容必须逐字来自该回复原文");
      await action("accept", {
        replyRfqId: replyId,
        replyRevision: reply.revision,
        evidenceQuote: acceptance,
        evidenceStart: start,
        evidenceEnd: start + acceptance.length,
      });
    } catch (e) {
      setFailure(e.message);
    }
  }
  const q = preview?.quote ?? data;
  return (
    <Dialog
      title="报价审阅"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="cn-button" onClick={onClose}>
            关闭
          </button>
          {data && (
            <button
              className="cn-button"
              disabled={busy}
              onClick={() => action("retry")}
            >
              核对上次提交
            </button>
          )}
          {data?.status === "review_required" && !preview && (
            <button className="cn-button" disabled={busy} onClick={review}>
              重新核验来源与政策
            </button>
          )}
          {preview &&
            data?.status === "review_required" &&
            preview.expectedRevision === data.revision && (
              <button
                className="cn-button cn-primary"
                disabled={busy}
                onClick={() =>
                  action("approve", { reviewDigest: preview.reviewDigest })
                }
              >
                批准此收件人与精确正文
              </button>
            )}
          {data?.status === "approved" && (
            <button
              className="cn-button cn-primary"
              disabled={busy || !data.approval?.channel}
              onClick={() =>
                action("send", { approvalReceiptId: data.approval.id })
              }
            >
              发送这份已批准报价
            </button>
          )}
          {["review_required", "approved", "sent"].includes(data?.status) && (
            <button
              className="cn-button"
              disabled={busy}
              onClick={() => action("withdraw")}
            >
              撤销报价
            </button>
          )}
        </>
      }
    >
      {(error || failure) && <p role="alert">{error || failure}</p>}
      {!data && !error && <p role="status">正在读取…</p>}
      {q && (
        <>
          <Receipt data={q} />
          <dl>
            <dt>发件账号</dt>
            <dd>
              {(preview?.channel || q.approval?.channel)?.accountRef ||
                "尚未配置，不能发送"}{" "}
              · {(preview?.channel || q.approval?.channel)?.from || ""}
            </dd>
            <dt>收件人</dt>
            <dd>{q.recipient}</dd>
            <dt>主题</dt>
            <dd>{q.subject}</dd>
            <dt>商品小计</dt>
            <dd>{money(q.totalMinor, q.currency)}</dd>
            <dt>产品版本 / 报价政策版本</dt>
            <dd>
              {q.productRef.revision} / {q.pricingRuleRevision}
            </dd>
            <dt>有效期</dt>
            <dd>{q.validUntil}</dd>
          </dl>
          <pre className="cn-trade-source">{q.body}</pre>
          <code>{q.bodySha256}</code>
          {preview && (
            <section>
              <h3>Owner 审核的价格依据</h3>
              <p>
                最低单价：
                {money(preview.policy.minimumUnitPriceMinor, q.currency)}
              </p>
              <p>{preview.policy.floorEvidence}</p>
              <p>{preview.policy.sourceReviewEvidence}</p>
              <code>{preview.reviewDigest}</code>
            </section>
          )}
          {q.outbox && (
            <section>
              <h3>真实通道回执</h3>
              <p>
                {q.outbox.status === "unknown"
                  ? "发送结果不明，须向通道核查。系统不会自动重发。"
                  : q.outbox.status}
              </p>
              <p>
                {q.outbox.result?.providerMessageId || "尚未取得外部消息 ID"}
              </p>
              {["unknown", "sending"].includes(q.outbox.status) && (
                <>
                  <label className="cn-field">
                    通道中的消息 ID
                    <input
                      value={providerId}
                      onChange={(e) => setProviderId(e.target.value)}
                    />
                  </label>
                  <button
                    className="cn-button"
                    disabled={busy || !providerId}
                    onClick={() =>
                      action("reconcile", { providerMessageId: providerId })
                    }
                  >
                    读取通道并核对正文
                  </button>
                </>
              )}
            </section>
          )}
          <p>接受回复须另行核对真实入站来源；报价接受不会创建或确认订单。</p>
          {q.status === "sent" && (
            <section>
              <h3>登记已核对的买手同意</h3>
              <label className="cn-field">
                回复询盘 ID
                <input
                  value={replyId}
                  onChange={(e) => setReplyId(e.target.value)}
                />
              </label>
              <label className="cn-field">
                买手同意的原文（逐字引用）
                <textarea
                  value={acceptance}
                  onChange={(e) => setAcceptance(e.target.value)}
                />
              </label>
              <button
                className="cn-button"
                disabled={busy || !replyId || !acceptance}
                onClick={acceptReply}
              >
                确认此回复表示接受报价
              </button>
            </section>
          )}
        </>
      )}
    </Dialog>
  );
}
function RfqReview({ sessionId, workspaceId, id, onClose, onRefresh }) {
  const [buyerAfter, setBuyerAfter] = useState("");
  const { data, error, reload } = useRead(
      `/rfq-desk-api/read?${new URLSearchParams({ sessionId, id, includeRaw: "true" })}`,
    ),
    buyers = useRead(
      `/mini-erp-api/workspaces/${encodeURIComponent(workspaceId)}/read?entity=buyer&limit=100&afterId=${encodeURIComponent(buyerAfter)}`,
    );
  const [buyerId, setBuyer] = useState(""),
    [evidence, setEvidence] = useState(""),
    [allowed, setAllowed] = useState(false),
    [validUntil, setValid] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(null);
  const candidate = data?.candidates?.at(-1),
    buyer = buyers.data?.items.find((b) => b.id === buyerId);
  async function save() {
    setBusy(true);
    try {
      await tradeApi("/rfq-desk-api/command", {
        body: {
          sessionId,
          action: "review",
          id,
          requestId: requestId(),
          expectedRevision: data.revision,
          candidateId: candidate.id,
          status:
            data.status === "qualified"
              ? "ready_for_quote"
              : [
                    "quantity",
                    "unit",
                    "destination",
                    "incoterm",
                    "namedPlace",
                    "currency",
                  ].some((k) => candidate.requirements[k] === undefined)
                ? "needs_info"
                : "qualified",
          ...(buyerId
            ? {
                buyerRef: buyerId,
                identityEvidence: evidence,
                contactPermission: {
                  status: allowed ? "allowed" : "unknown",
                  evidence,
                  recipient: buyer?.email,
                  validUntil: allowed
                    ? new Date(validUntil).toISOString()
                    : undefined,
                },
              }
            : {}),
        },
      });
      reload();
      onRefresh?.();
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="核对询盘来源"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="cn-button" onClick={onClose}>
            关闭
          </button>
          <button
            className="cn-button cn-primary"
            disabled={
              busy ||
              !candidate ||
              (!data?.buyerRef && (!buyerId || !evidence)) ||
              (allowed && (!buyer?.email || !validUntil)) ||
              !["received", "needs_info", "qualified"].includes(data?.status)
            }
            onClick={save}
          >
            {data?.status === "qualified" ? "确认可准备报价" : "确认采购字段"}
          </button>
        </>
      }
    >
      {(error || failure) && <p role="alert">{error || failure}</p>}
      {data && (
        <>
          <Receipt data={data} />
          <pre className="cn-trade-source">
            {data.rawText || "来源已到保留期限"}
          </pre>
          <h3>模型提取候选</h3>
          {candidate ? (
            <dl>
              {Object.entries(candidate.requirements).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {String(v)}
                    <small>
                      原文：{candidate.fieldEvidence[k]?.quote || "不可用"}
                    </small>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <p>在当前会话中让 Assistant 提取字段并保留原文依据。</p>
          )}
          {!data.buyerRef && (
            <>
              <label className="cn-field">
                ERP 客户
                <select
                  value={buyerId}
                  onChange={(e) => setBuyer(e.target.value)}
                >
                  <option value="">选择已有客户</option>
                  {buyers.data?.items.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.email || "无邮箱"}
                    </option>
                  ))}
                </select>
              </label>
              {buyers.error && <p role="alert">{buyers.error}</p>}
              {(buyerAfter || buyers.data?.hasMore) && (
                <div>
                  {buyerAfter && (
                    <button
                      className="cn-button"
                      onClick={() => {
                        setBuyer("");
                        setBuyerAfter("");
                      }}
                    >
                      回到第一页客户
                    </button>
                  )}
                  {buyers.data?.hasMore && (
                    <button
                      className="cn-button"
                      onClick={() => {
                        setBuyer("");
                        setBuyerAfter(buyers.data.nextCursor);
                      }}
                    >
                      下一页客户
                    </button>
                  )}
                </div>
              )}
              <label className="cn-field">
                身份核对与联系依据
                <textarea
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={(e) => setAllowed(e.target.checked)}
                />
                我已核对，允许向此邮箱发送这次交易的报价
              </label>
              {allowed && (
                <label className="cn-field">
                  联系许可截止时间
                  <input
                    type="datetime-local"
                    value={validUntil}
                    onChange={(e) => setValid(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <p>“字段已核对”不代表买手工商身份已验证。任何回复草稿均未发送。</p>
        </>
      )}
    </Dialog>
  );
}
function PolicyReview({ sessionId, workspaceId, onClose }) {
  const [productAfter, setProductAfter] = useState("");
  const products = useRead(
    `/mini-erp-api/workspaces/${encodeURIComponent(workspaceId)}/read?entity=product&limit=100&afterId=${encodeURIComponent(productAfter)}`,
  );
  const [productId, setProduct] = useState(""),
    [floor, setFloor] = useState(""),
    [evidence, setEvidence] = useState(""),
    [incoterm, setTerm] = useState("FOB"),
    [place, setPlace] = useState(""),
    [days, setDays] = useState(""),
    [until, setUntil] = useState(""),
    [revision, setRevision] = useState("0"),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false);
  const p = products.data?.items.find((p) => p.id === productId);
  async function save() {
    setBusy(true);
    try {
      if (!/^\d+(\.\d{1,2})?$/.test(floor))
        throw Error("最低单价须为两位小数以内");
      const [whole, fraction = ""] = floor.split(".");
      const data = await tradeApi("/quote-guard-api/policy", {
        body: {
          sessionId,
          requestId: requestId(),
          expectedRevision: Number(revision),
          productId,
          policy: {
            productId: p.catalogProductId,
            productRevision: p.catalogRevision,
            skuId: p.skuId,
            currency: p.currency,
            minimumUnitPriceMinor:
              Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
            floorEvidence: evidence,
            sourceReviewEvidence: evidence,
            incoterm,
            namedPlace: place,
            leadTimeDays: Number(days),
            validUntil: new Date(until).toISOString(),
            disclosureFields: [
              "productName",
              "sku",
              "quantity",
              "unit",
              "currency",
              "unitPriceMinor",
              "totalMinor",
              "incoterm",
              "namedPlace",
              "leadTimeDays",
              "validUntil",
            ],
          },
        },
      });
      setResult("报价政策已保存。请回到当前会话准备报价。");
      setRevision(String(Number(revision) + 1));
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="审核报价政策"
      onClose={onClose}
      footer={
        <>
          <button className="cn-button" onClick={onClose}>
            关闭
          </button>
          <button
            className="cn-button cn-primary"
            disabled={
              busy || !p || !floor || !evidence || !place || !days || !until
            }
            onClick={save}
          >
            保存所审核的条款
          </button>
        </>
      }
    >
      {products.error && <p role="alert">{products.error}</p>}
      {result && <p role="status">{result}</p>}
      <label className="cn-field">
        ERP 已关联商品
        <select value={productId} onChange={(e) => setProduct(e.target.value)}>
          <option value="">选择商品</option>
          {products.data?.items
            .filter((p) => p.catalogStatus === "linked")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.skuCode} · v{p.catalogRevision}
              </option>
            ))}
        </select>
      </label>
      {(productAfter || products.data?.hasMore) && (
        <div>
          {productAfter && (
            <button
              className="cn-button"
              onClick={() => {
                setProduct("");
                setProductAfter("");
              }}
            >
              回到第一页商品
            </button>
          )}
          {products.data?.hasMore && (
            <button
              className="cn-button"
              onClick={() => {
                setProduct("");
                setProductAfter(products.data.nextCursor);
              }}
            >
              下一页商品
            </button>
          )}
        </div>
      )}
      {p && (
        <p>
          来源：{p.source} · 币种 {p.currency}
        </p>
      )}
      {[
        [floor, setFloor, "最低单价"],
        [place, setPlace, "贸易条款指定地点"],
        [days, setDays, "交期天数"],
        [revision, setRevision, "当前政策修订（首次为 0）"],
      ].map(([value, set, label]) => (
        <label className="cn-field" key={label}>
          {label}
          <input value={value} onChange={(e) => set(e.target.value)} />
        </label>
      ))}
      <label className="cn-field">
        Incoterm
        <select value={incoterm} onChange={(e) => setTerm(e.target.value)}>
          {[
            "EXW",
            "FCA",
            "FAS",
            "FOB",
            "CFR",
            "CIF",
            "CPT",
            "CIP",
            "DAP",
            "DPU",
            "DDP",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="cn-field">
        有效截止时间
        <input
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </label>
      <label className="cn-field">
        产品版本、最低售价和披露审核依据
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <p>
        仅允许披露报价中的商品与交易条款。没有成本、税费、运费证据时，不计算利润。
      </p>
    </Dialog>
  );
}
export function ImportRfq({ sessionId, projectId, onClose, onRefresh }) {
  const [raw, setRaw] = useState(""),
    [name, setName] = useState(""),
    [account, setAccount] = useState(""),
    [message, setMessage] = useState(""),
    [evidence, setEvidence] = useState(""),
    [at, setAt] = useState(""),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  async function load(file) {
    setError(null);
    if (!file) return;
    if (file.size > 65536) {
      setError("来源文件不得超过 64 KiB");
      return;
    }
    try {
      const text = await file.text();
      if (file.name.endsWith(".json")) JSON.parse(text);
      setRaw(text);
      setName(file.name);
    } catch {
      setError("文件读取或 JSON 格式无效");
    }
  }
  async function save() {
    setBusy(true);
    try {
      const bytes = new TextEncoder().encode(raw),
        digest = await crypto.subtle.digest("SHA-256", bytes),
        sha = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      await tradeApi("/rfq-desk-api/command", {
        body: {
          sessionId,
          action: "import",
          requestId: requestId(),
          expectedRevision: 0,
          projectId,
          rawText: raw,
          authorizationEvidence: `${evidence}; file: ${name}`,
          source: {
            channel: "import",
            accountRef: account,
            externalMessageId: message,
            receivedAt: new Date(at).toISOString(),
            rawEvidenceSha256: sha,
          },
        },
      });
      onRefresh?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="导入已获授权的询盘"
      onClose={onClose}
      footer={
        <>
          <button className="cn-button" onClick={onClose}>
            关闭
          </button>
          <button
            className="cn-button cn-primary"
            disabled={busy || !raw || !account || !message || !evidence || !at}
            onClick={save}
          >
            保存来源记录
          </button>
        </>
      }
    >
      <p>
        选择属于你的单条询盘 CSV / JSON 文件。导入不会回复、发送报价或创建客户。
      </p>
      {error && <p role="alert">{error}</p>}
      <label className="cn-field">
        来源文件
        <input
          type="file"
          accept=".csv,.json"
          onChange={(e) => load(e.target.files[0])}
        />
      </label>
      {[
        [account, setAccount, "来源账号或导入批次"],
        [message, setMessage, "原始消息 ID"],
        [evidence, setEvidence, "来源与使用授权依据"],
      ].map(([v, set, label]) => (
        <label className="cn-field" key={label}>
          {label}
          <input value={v} onChange={(e) => set(e.target.value)} />
        </label>
      ))}
      <label className="cn-field">
        原始接收时间
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </label>
      <pre className="cn-trade-source">{raw}</pre>
    </Dialog>
  );
}
function SampleReview({ sessionId, id, onClose, onRefresh }) {
  const { data, error, reload } = useRead(
      `/sample-flow-api/read?${new URLSearchParams({ sessionId, id })}`,
    ),
    [file, setFile] = useState(null),
    [provider, setProvider] = useState(""),
    [externalId, setExternal] = useState(""),
    [at, setAt] = useState(""),
    [fee, setFee] = useState(""),
    [orderId, setOrder] = useState(""),
    [carrier, setCarrier] = useState(""),
    [tracking, setTracking] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(null);
  const action = {
    draft: "approve",
    approved: "ship",
    shipped: "deliver",
    delivered: "feedback",
  }[data?.status];
  async function submit() {
    setBusy(true);
    try {
      if (file.size > 262144) throw Error("凭据不得超过 256 KiB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const ref = await tradeApi("/sample-flow-api/upload-evidence", {
        body: { sessionId, fileName: file.name, dataBase64: btoa(binary) },
      });
      const command = {
        sessionId,
        id,
        action,
        requestId: requestId(),
        expectedRevision: data.revision,
        evidence: {
          ...ref,
          provider,
          externalEventId: externalId,
          occurredAt: new Date(at).toISOString(),
        },
      };
      if (action === "approve") {
        if (!/^\d+(\.\d{1,2})?$/.test(fee)) throw Error("费用最多两位小数");
        const [whole, fraction = ""] = fee.split(".");
        Object.assign(command, {
          feeMinor: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
          currency: data.currency,
        });
      }
      if (action === "ship")
        Object.assign(command, { orderId, carrier, trackingId: tracking });
      if (action === "feedback") command.feedback = feedback;
      await tradeApi("/sample-flow-api/command", { body: command });
      reload();
      onRefresh?.();
      setFile(null);
    } catch (e) {
      setFailure(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="样品记录与来源"
      onClose={onClose}
      footer={
        <>
          <button className="cn-button" onClick={onClose}>
            关闭
          </button>
          {action && (
            <button
              className="cn-button cn-primary"
              disabled={busy || !file || !provider || !externalId || !at}
              onClick={submit}
            >
              {
                {
                  approve: "批准样品费用",
                  ship: "登记有凭据的寄送",
                  deliver: "登记签收凭据",
                  feedback: "登记真实反馈",
                }[action]
              }
            </button>
          )}
        </>
      }
    >
      <p>费用批准、仓库分配与寄送凭据分别记录；当前没有自动物流或付款服务。</p>
      {(error || failure) && <p role="alert">{error || failure}</p>}
      {data && (
        <>
          <Receipt data={data} />
          <p>
            数量 {data.quantity} · {data.carrier || "尚无承运商"} ·{" "}
            {data.trackingId || "尚无运单"}
          </p>
          {action && (
            <>
              <label className="cn-field">
                原始凭据文件
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files[0])}
                />
              </label>
              {[
                [provider, setProvider, "凭据提供者"],
                [externalId, setExternal, "外部事件编号"],
              ].map(([v, set, label]) => (
                <label className="cn-field" key={label}>
                  {label}
                  <input value={v} onChange={(e) => set(e.target.value)} />
                </label>
              ))}
              <label className="cn-field">
                事件时间
                <input
                  type="datetime-local"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                />
              </label>
              {action === "approve" && (
                <label className="cn-field">
                  样品费用 · {data.currency}
                  <input value={fee} onChange={(e) => setFee(e.target.value)} />
                </label>
              )}
              {action === "ship" &&
                [
                  [orderId, setOrder, "已独立确认的库存订单 ID"],
                  [carrier, setCarrier, "承运商"],
                  [tracking, setTracking, "运单号"],
                ].map(([v, set, label]) => (
                  <label className="cn-field" key={label}>
                    {label}
                    <input value={v} onChange={(e) => set(e.target.value)} />
                  </label>
                ))}
              {action === "feedback" && (
                <label className="cn-field">
                  买手反馈
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <pre className="cn-trade-source">
            {JSON.stringify(data.events, null, 2)}
          </pre>
        </>
      )}
    </Dialog>
  );
}
