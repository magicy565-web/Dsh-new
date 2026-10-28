import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "./Inspector.jsx";
import { tradeApi } from "./TradeInspector.jsx";
import { requestId, errorText } from "./api.mjs";
import { money } from "./model.mjs";
const names = {
  draft: "待确认",
  issued: "已确认",
  void: "已作废",
  not_due: "未形成应收",
  paid: "已收齐",
  partially_paid: "部分收款",
  unpaid: "待收款",
  fixed_fee: "固定委托费",
  monthly_fee: "月服务费",
  collection: "登记收款",
  refund: "登记退款",
  issue: "确认账单",
};
const billingError = (e) =>
  ["REVISION_CONFLICT", "BILLING_TERMS_CHANGED"].includes(e?.code) ||
  [401, 403].includes(e?.status)
    ? errorText(e)
    : e?.message || "操作未完成，请核对记录。";
const minor = (value) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error("请输入最多两位小数的正数金额。");
  const [w, d = ""] = value.split(".");
  const n = Number(w) * 100 + Number(d.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0) throw Error("金额须大于 0。");
  return n;
};
export function ServiceBilling({
  sessionId,
  workspaceId,
  projectId,
  mandate,
  onClose,
}) {
  const [listing, setListing] = useState(null),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [period, setPeriod] = useState(mandate.businessTerms.startDate || ""),
    [review, setReview] = useState(null),
    [form, setForm] = useState(null),
    [amount, setAmount] = useState(""),
    [provider, setProvider] = useState(""),
    [external, setExternal] = useState(""),
    [occurred, setOccurred] = useState(""),
    [file, setFile] = useState(null),
    [collection, setCollection] = useState(""),
    [reason, setReason] = useState("");
  const key = `service-billing:v1:${sessionId}:${workspaceId}:${mandate.id}`;
  const [pending, setPending] = useState(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    }),
    life = useRef(null),
    locked = useRef(false),
    requestSequence = useRef(0);
  const bill = listing?.items.find((r) => r.id === selected);
  async function load(afterId = "") {
    const seq = ++requestSequence.current;
    try {
      const value = await tradeApi(
        "/service-billing-api/list?" +
          new URLSearchParams({
            sessionId,
            projectId,
            mandateId: mandate.id,
            ...(afterId ? { afterId } : {}),
          }),
        { signal: life.current?.signal },
      );
      if (!life.current?.signal.aborted && seq === requestSequence.current) {
        setListing(value);
        setSelected((id) =>
          value.items.some((r) => r.id === id)
            ? id
            : value.items[0]?.id || null,
        );
        setError("");
      }
    } catch (e) {
      if (!life.current?.signal.aborted && seq === requestSequence.current)
        setError(
          e.status === 404
            ? "未安装独立服务计费插件，当前没有收费能力。"
            : billingError(e),
        );
    }
  }
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    void load();
    return () => c.abort();
  }, []);
  async function send(envelope) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      sessionStorage.setItem(key, JSON.stringify(envelope));
      setPending(envelope);
      const result = await tradeApi("/service-billing-api/write", {
        body: envelope,
        signal: life.current.signal,
      });
      if (life.current.signal.aborted) return;
      if (!result.current?.id) throw Error("返回结果不完整，请用原请求重试。");
      sessionStorage.removeItem(key);
      setPending(null);
      setReview(null);
      setForm(null);
      setSelected(result.current.id);
      await load();
    } catch (e) {
      if (life.current.signal.aborted) return;
      if (e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      setError(billingError(e));
    } finally {
      locked.current = false;
      if (!life.current.signal.aborted) setBusy(false);
    }
  }
  const write = (payload) =>
    send({ sessionId, requestId: requestId(), ...payload });
  async function prepareEvidence() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (!file || file.size < 1 || file.size > 262144)
        throw Error("请选择不超过 256 KiB 的实际收退款凭据。");
      if (!provider.trim() || !external.trim() || !occurred)
        throw Error("请填写机构账号、交易编号和发生时间。");
      const value = minor(amount),
        ms = Date.parse(occurred + "Z");
      if (!Number.isFinite(ms)) throw Error("发生时间无效。");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const ref = await tradeApi("/service-billing-api/upload-evidence", {
        body: { sessionId, fileName: file.name, dataBase64: btoa(binary) },
        signal: life.current.signal,
      });
      if (life.current.signal.aborted) return;
      setReview({
        bill: form.bill,
        payload: {
          action: form.action,
          id: form.bill.id,
          expectedRevision: form.bill.revision,
          amountMinor: value,
          currency: form.bill.currency,
          evidence: {
            ...ref,
            provider: provider.trim(),
            externalEventId: external.trim(),
            occurredAt: new Date(ms).toISOString(),
          },
          ...(form.action === "refund" ? { collectionId: collection } : {}),
        },
      });
    } catch (e) {
      if (!life.current.signal.aborted) setError(billingError(e));
    } finally {
      locked.current = false;
      if (!life.current.signal.aborted) setBusy(false);
    }
  }
  const close = () => {
    if (!busy && !pending) onClose();
  };
  return (
    <Dialog
      wide
      title="服务账单与对账"
      onClose={close}
      footer={
        <button
          className="cn-button"
          disabled={busy || !!pending}
          onClick={close}
        >
          返回业务委托
        </button>
      }
    >
      <div className="cn-billing">
        <p>
          {mandate.title} · 条款 v{mandate.businessTerms.version}
        </p>
        <p>
          独立服务计费插件。内部对账单，不是税务发票；记录凭据不会发起扣款或退款。
        </p>
        {error && (
          <p role="alert" className="cn-danger-text">
            {error}
          </p>
        )}
        {pending && (
          <p role="status">
            提交结果待核实，已保留原请求。
            <button
              className="cn-button"
              disabled={busy}
              onClick={() => send(pending)}
            >
              用原请求重试
            </button>
          </p>
        )}
        <fieldset disabled={busy || !!pending}>
          <button
            className="cn-button"
            onClick={() => {
              setReview(null);
              setForm(null);
              void load();
            }}
          >
            刷新账单
          </button>
          {!listing && !error && <p>读取账单中…</p>}
          {listing && (
            <>
              {review ? (
                <section aria-label="核对账单操作">
                  <h3>{names[review.payload.action] || "作废账单"}</h3>
                  <p>
                    账单 {review.bill.id} · 修订 {review.bill.revision}
                  </p>
                  <p>
                    {names[review.bill.kind]} ·{" "}
                    {money(review.bill.amountMinor, review.bill.currency)}
                  </p>
                  <p>
                    账期：{review.bill.periodStart} 至{" "}
                    {review.bill.periodEndExclusive}（不含结束日）
                  </p>
                  <p>协议依据：{review.bill.businessTerms.agreementEvidence}</p>
                  <p>
                    委托方 {review.bill.principalPartyId} → 服务方{" "}
                    {review.bill.operatorPartyId}
                  </p>
                  {review.payload.evidence && (
                    <>
                      <p>
                        本次金额：
                        {money(
                          review.payload.amountMinor,
                          review.bill.currency,
                        )}
                      </p>
                      <p>
                        {review.payload.evidence.provider} · 交易号{" "}
                        {review.payload.evidence.externalEventId}
                      </p>
                      <p>发生时间：{review.payload.evidence.occurredAt}</p>
                      <p>
                        凭据 SHA-256：
                        <code>{review.payload.evidence.sha256}</code>
                      </p>
                      {review.payload.collectionId && (
                        <p>对应收款：{review.payload.collectionId}</p>
                      )}
                      <p>
                        你正在核对附件与交易的对应关系。字节校验不代表银行或提供方已经认证该交易。
                      </p>
                    </>
                  )}
                  {review.payload.reason && (
                    <p>作废原因：{review.payload.reason}</p>
                  )}
                  <button
                    className="cn-button cn-primary"
                    onClick={() => write(review.payload)}
                  >
                    确认记录
                  </button>
                  <button className="cn-button" onClick={() => setReview(null)}>
                    返回核对
                  </button>
                </section>
              ) : (
                <>
                  <section>
                    <h3>生成服务账单草稿</h3>
                    {mandate.businessTerms.mode === "sourcing_commission" ? (
                      <p>纯佣金委托不收固定费或月服务费。</p>
                    ) : (
                      <>
                        {mandate.businessTerms.mode ===
                          "channel_subscription" && (
                          <label className="cn-field">
                            <span>服务月开始日（UTC）</span>
                            <input
                              type="date"
                              value={period}
                              onChange={(e) => setPeriod(e.target.value)}
                            />
                          </label>
                        )}
                        <p>
                          金额来自已审核条款：
                          {money(
                            mandate.businessTerms.mode === "factory_sales"
                              ? mandate.businessTerms.fixedFeeMinor
                              : mandate.businessTerms.monthlyFeeMinor,
                            mandate.businessTerms.currency,
                          )}
                          。月账期按合同起始日计算，未开始或不足整月的账期不自动收费。
                        </p>
                        <button
                          className="cn-button"
                          disabled={mandate.status !== "active"}
                          onClick={() =>
                            write({
                              action: "draft",
                              projectId,
                              mandateId: mandate.id,
                              expectedMandateRevision: mandate.revision,
                              kind:
                                mandate.businessTerms.mode === "factory_sales"
                                  ? "fixed_fee"
                                  : "monthly_fee",
                              ...(mandate.businessTerms.mode ===
                              "channel_subscription"
                                ? { periodStart: period }
                                : {}),
                            })
                          }
                        >
                          生成账单草稿
                        </button>
                      </>
                    )}
                  </section>
                  <nav className="cn-business-list">
                    {listing.items.map((r) => (
                      <button
                        className="cn-button"
                        key={r.id}
                        onClick={() => {
                          setSelected(r.id);
                          setForm(null);
                        }}
                      >
                        {names[r.kind]} · {r.periodStart} · {names[r.status]} /{" "}
                        {names[r.paymentStatus]}
                      </button>
                    ))}
                  </nav>
                  {listing.hasMore && (
                    <button
                      className="cn-button"
                      onClick={() => {
                        setForm(null);
                        void load(listing.nextCursor);
                      }}
                    >
                      下一页账单
                    </button>
                  )}
                  {!listing.items.length && <p>暂无服务账单。</p>}
                  {bill && (
                    <section aria-label="账单详情">
                      <h3>
                        {names[bill.kind]} · {names[bill.status]} /{" "}
                        {names[bill.paymentStatus]}
                      </h3>
                      <p>
                        编号 {bill.id} · 条款 v{bill.businessTerms.version} ·
                        账单修订 {bill.revision}
                      </p>
                      <p>
                        {bill.periodStart} 至 {bill.periodEndExclusive}
                        （不含结束日）
                      </p>
                      <dl className="cn-billing-totals">
                        {Object.entries({
                          账单金额: bill.amountMinor,
                          累计收款: bill.collectedMinor,
                          累计退款: bill.refundedMinor,
                          净收款: bill.netCollectedMinor,
                          未收余额: bill.outstandingMinor,
                        }).map(([label, value]) => (
                          <React.Fragment key={label}>
                            <dt>{label}</dt>
                            <dd>
                              {value === null
                                ? "未确认"
                                : money(value, bill.currency)}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                      {bill.status === "draft" && (
                        <button
                          className="cn-button cn-primary"
                          onClick={() =>
                            setReview({
                              bill: structuredClone(bill),
                              payload: {
                                action: "issue",
                                id: bill.id,
                                expectedRevision: bill.revision,
                              },
                            })
                          }
                        >
                          核对并确认账单
                        </button>
                      )}
                      {bill.status === "issued" && (
                        <>
                          <button
                            className="cn-button"
                            onClick={() => {
                              setForm({
                                action: "collection",
                                bill: structuredClone(bill),
                              });
                              setAmount("");
                              setFile(null);
                            }}
                          >
                            登记收款凭据
                          </button>
                          {bill.netCollectedMinor > 0 && (
                            <button
                              className="cn-button"
                              onClick={() => {
                                setForm({
                                  action: "refund",
                                  bill: structuredClone(bill),
                                });
                                setAmount("");
                                setFile(null);
                                setCollection("");
                              }}
                            >
                              登记退款凭据
                            </button>
                          )}
                        </>
                      )}
                      {bill.status !== "void" &&
                        !bill.events.some((e) =>
                          ["collection", "refund"].includes(e.kind),
                        ) && (
                          <>
                            <label className="cn-field">
                              <span>作废原因</span>
                              <input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            </label>
                            <button
                              className="cn-button"
                              disabled={!reason.trim()}
                              onClick={() =>
                                setReview({
                                  bill: structuredClone(bill),
                                  payload: {
                                    action: "void",
                                    id: bill.id,
                                    expectedRevision: bill.revision,
                                    reason,
                                  },
                                })
                              }
                            >
                              核对作废
                            </button>
                          </>
                        )}
                      <details>
                        <summary>
                          账单事件与凭据（{bill.events.length}）
                        </summary>
                        {bill.events.map((e) => (
                          <p key={e.id}>
                            {names[e.kind] || e.kind} · {e.at}
                            {e.amountMinor !== undefined
                              ? ` · ${money(e.amountMinor, bill.currency)}`
                              : ""}
                            {e.evidence && (
                              <>
                                {" "}
                                · {e.evidence.provider} /{" "}
                                {e.evidence.externalEventId}
                                <br />
                                <code>{e.evidence.sha256}</code>
                              </>
                            )}
                            {e.reason && ` · ${e.reason}`}
                          </p>
                        ))}
                      </details>
                    </section>
                  )}
                  {form && (
                    <section aria-label="收退款凭据表单">
                      <h3>{names[form.action]}</h3>
                      <p>退款只冲回收款并恢复未收余额，不会自动减免账单。</p>
                      <label className="cn-field">
                        <span>本次金额（{form.bill.currency}）</span>
                        <input
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </label>
                      {form.action === "refund" && (
                        <label className="cn-field">
                          <span>对应收款</span>
                          <select
                            aria-label="对应收款"
                            value={collection}
                            onChange={(e) => setCollection(e.target.value)}
                          >
                            <option value="">请选择</option>
                            {form.bill.events
                              .filter((e) => e.kind === "collection")
                              .map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.evidence.externalEventId} ·{" "}
                                  {money(e.amountMinor, form.bill.currency)}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <label className="cn-field">
                        <span>机构与账号标识（不填密码）</span>
                        <input
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                        />
                      </label>
                      <label className="cn-field">
                        <span>外部交易编号</span>
                        <input
                          value={external}
                          onChange={(e) => setExternal(e.target.value)}
                        />
                      </label>
                      <label className="cn-field">
                        <span>实际发生时间（UTC）</span>
                        <input
                          type="datetime-local"
                          step="1"
                          value={occurred}
                          onChange={(e) => setOccurred(e.target.value)}
                        />
                      </label>
                      <label className="cn-field">
                        <span>实际收退款凭据</span>
                        <input
                          type="file"
                          onChange={(e) => setFile(e.target.files?.[0] || null)}
                        />
                      </label>
                      <button
                        className="cn-button cn-primary"
                        onClick={prepareEvidence}
                      >
                        上传并核对凭据
                      </button>
                      <button
                        className="cn-button"
                        onClick={() => setForm(null)}
                      >
                        取消登记
                      </button>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
