import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "./Inspector.jsx";
import { callApi, stateFrom, requestId, errorText } from "./api.mjs";
import { money, STATUSES } from "./model.mjs";
import {
  BUSINESS_MODES,
  BUSINESS_CURRENCIES,
} from "../../../../packages/domain-commerce-network/src/business-mandate.mjs";

export function decimalMinor(value) {
  if (value === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("金额和比例最多保留两位小数。");
  const [whole, fraction = ""] = value.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw new Error("金额超出范围。");
  return n;
}
const blank = (mode) => ({
  version: 1,
  mode,
  currency: "USD",
  startDate: null,
  endDate: null,
  fixedFeeMinor: null,
  monthlyFeeMinor: null,
  aiCredits: {
    payer: mode === "sourcing_commission" ? "operator" : "principal",
    policy: "",
  },
  commission:
    mode === "channel_subscription"
      ? null
      : { rateBps: null, basis: null, trigger: null, refundRule: null },
  agreementEvidence: "",
});
const names = (ids, rows) =>
  ids
    ?.map(
      (id) =>
        rows?.find((r) => r.id === id)?.name ||
        rows?.find((r) => r.id === id)?.title ||
        id,
    )
    .join("、") || "未关联";
export function BusinessSummary({ record, state }) {
  const t = record.businessTerms,
    net = state.commerceNetwork || {},
    party = (id) => net.parties?.find((p) => p.id === id)?.displayName || id;
  return (
    <div className="cn-business-summary">
      <h3>
        {record.title} · v{t.version}
      </h3>
      <p>
        {BUSINESS_MODES[t.mode]} ·{" "}
        {STATUSES[record.effectiveStatus || record.status] || record.status}
      </p>
      <dl>
        {Object.entries({
          委托方: party(record.principalPartyId),
          服务方: party(record.operatorPartyId),
          市场: record.marketCode,
          业务范围: record.scope,
          "有效期（UTC，含结束日）": `${t.startDate || "待约定"} 至 ${t.endDate || "待约定"}`,
          固定委托费:
            t.mode === "factory_sales"
              ? money(t.fixedFeeMinor, t.currency)
              : "不适用",
          月订阅费:
            t.mode === "channel_subscription"
              ? money(t.monthlyFeeMinor, t.currency)
              : "不适用",
          "AI Credits 承担方":
            t.aiCredits.payer === "principal" ? "委托方" : "服务方",
          "AI 用量约定": t.aiCredits.policy || "待约定",
          佣金: t.commission
            ? `${t.commission.rateBps === null ? "待约定" : t.commission.rateBps / 100 + "%"}；${t.commission.basis ? "净商品实收金额" : "基数待约定"}；${t.commission.trigger ? "核实收款后计提" : "触发条件待约定"}；${t.commission.refundRule ? "退款按比例冲回" : "退款规则待约定"}`
            : "不收佣金",
          协议依据: t.agreementEvidence || "待提供",
          关联产品: names(record.productIds, state.products),
          关联渠道: names(record.routeIds, state.routes),
          关联工单: names(record.workOrderIds, net.workOrders),
        }).map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p>
        收费尚未接通；审核仅确认条款，不是法律签署。关联记录不授予 Agent
        权限，修改或撤销委托不会自动停止已有工单。
      </p>
      <h4>关联交付</h4>
      {(state.deliverables || [])
        .filter((d) => record.workOrderIds?.includes(d.orderId))
        .map((d) => (
          <p key={d.id}>
            {d.title || d.id} · {d.id}
          </p>
        ))}
      {!(state.deliverables || []).some((d) =>
        record.workOrderIds?.includes(d.orderId),
      ) && <p>暂无交付记录。</p>}
    </div>
  );
}
function Editor({ record, state, onSave, disabled }) {
  const [v, setV] = useState(() =>
    record
      ? {
          ...record,
          businessTerms: {
            ...record.businessTerms,
            version: record.businessTerms.version + 1,
          },
        }
      : {
          title: "",
          principalPartyId: "",
          operatorPartyId: "",
          marketCode: "",
          scope: "",
          productIds: [],
          routeIds: [],
          workOrderIds: [],
          businessTerms: blank("factory_sales"),
        },
  );
  const t = v.businessTerms,
    net = state.commerceNetwork || {},
    patch = (x) => setV((a) => ({ ...a, ...x })),
    terms = (x) =>
      setV((a) => ({ ...a, businessTerms: { ...a.businessTerms, ...x } }));
  const [fee, setFee] = useState(
      record?.businessTerms.fixedFeeMinor == null
        ? ""
        : String(record.businessTerms.fixedFeeMinor / 100),
    ),
    [monthly, setMonthly] = useState(
      record?.businessTerms.monthlyFeeMinor == null
        ? ""
        : String(record.businessTerms.monthlyFeeMinor / 100),
    ),
    [rate, setRate] = useState(
      record?.businessTerms.commission?.rateBps == null
        ? ""
        : String(record.businessTerms.commission.rateBps / 100),
    ),
    [error, setError] = useState("");
  const field = (label, key) => (
    <label className="cn-field">
      <span>{label}</span>
      <input
        value={v[key]}
        onChange={(e) => patch({ [key]: e.target.value })}
      />
    </label>
  );
  const links = (label, key, rows) => (
    <fieldset>
      <legend>{label}</legend>
      {rows?.length ? (
        rows.map((r) => (
          <label key={r.id} className="cn-check">
            <input
              type="checkbox"
              checked={v[key].includes(r.id)}
              onChange={(e) =>
                patch({
                  [key]: e.target.checked
                    ? [...v[key], r.id]
                    : v[key].filter((id) => id !== r.id),
                })
              }
            />
            {r.name || r.title || r.id}
          </label>
        ))
      ) : (
        <p>尚无记录；可从原生会话创建后关联。</p>
      )}
    </fieldset>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const payload = {
            title: v.title,
            principalPartyId: v.principalPartyId,
            operatorPartyId: v.operatorPartyId,
            marketCode: v.marketCode,
            scope: v.scope,
            productIds: v.productIds,
            routeIds: v.routeIds,
            workOrderIds: v.workOrderIds,
            businessTerms: {
              ...t,
              fixedFeeMinor:
                t.mode === "factory_sales" ? decimalMinor(fee) : null,
              monthlyFeeMinor:
                t.mode === "channel_subscription"
                  ? decimalMinor(monthly)
                  : null,
              commission: t.commission
                ? { ...t.commission, rateBps: decimalMinor(rate) }
                : null,
            },
            ...(record ? { mandateId: record.id } : {}),
          };
          onSave(payload);
        } catch (e) {
          setError(e.message);
        }
      }}
    >
      <fieldset disabled={disabled}>
        <legend>{record ? "修改条款并重新审核" : "新建业务委托"}</legend>
        <label className="cn-field">
          <span>业务模式</span>
          <select
            aria-label="业务模式"
            value={t.mode}
            onChange={(e) => {
              patch({
                principalPartyId: "",
                businessTerms: { ...blank(e.target.value), version: t.version },
              });
              setFee("");
              setMonthly("");
              setRate("");
            }}
          >
            {Object.entries(BUSINESS_MODES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {field("委托名称", "title")}
        {["principalPartyId", "operatorPartyId"].map((key) => (
          <label className="cn-field" key={key}>
            <span>{key === "principalPartyId" ? "委托方" : "服务方"}</span>
            <select
              aria-label={key === "principalPartyId" ? "委托方" : "服务方"}
              value={v[key]}
              onChange={(e) => patch({ [key]: e.target.value })}
            >
              <option value="">请选择</option>
              {(net.parties || [])
                .filter((p) =>
                  key === "operatorPartyId"
                    ? p.type === "provider"
                    : t.mode === "factory_sales"
                      ? p.type === "factory"
                      : t.mode === "channel_subscription"
                        ? p.type === "distributor"
                        : true,
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {field("目标市场", "marketCode")}
        {field("业务范围与交付约定", "scope")}
        <label className="cn-field">
          <span>币种</span>
          <select
            aria-label="币种"
            value={t.currency}
            onChange={(e) => terms({ currency: e.target.value })}
          >
            {BUSINESS_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {["startDate", "endDate"].map((key) => (
          <label className="cn-field" key={key}>
            <span>{key === "startDate" ? "开始日期" : "结束日期"}（UTC）</span>
            <input
              type="date"
              value={t[key] || ""}
              onChange={(e) => terms({ [key]: e.target.value || null })}
            />
          </label>
        ))}
        {t.mode === "factory_sales" && (
          <label className="cn-field">
            <span>固定委托费（{t.currency}，空白为待约定）</span>
            <input
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
        )}
        {t.mode === "channel_subscription" && (
          <label className="cn-field">
            <span>月订阅费（{t.currency}，空白为待约定）</span>
            <input
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </label>
        )}
        <label className="cn-field">
          <span>AI Credits 承担方</span>
          <select
            aria-label="AI Credits 承担方"
            value={t.aiCredits.payer}
            disabled={t.mode !== "channel_subscription"}
            onChange={(e) =>
              terms({ aiCredits: { ...t.aiCredits, payer: e.target.value } })
            }
          >
            <option value="principal">委托方</option>
            <option value="operator">服务方</option>
          </select>
        </label>
        <label className="cn-field">
          <span>AI 用量与费用约定</span>
          <textarea
            value={t.aiCredits.policy}
            onChange={(e) =>
              terms({ aiCredits: { ...t.aiCredits, policy: e.target.value } })
            }
          />
        </label>
        {t.commission && (
          <>
            <label className="cn-field">
              <span>佣金比例（%，空白为待约定）</span>
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label className="cn-check">
              <input
                type="checkbox"
                checked={!!t.commission.basis}
                onChange={(e) =>
                  terms({
                    commission: {
                      ...t.commission,
                      basis: e.target.checked ? "net_collected_goods" : null,
                      trigger: e.target.checked ? "verified_collection" : null,
                      refundRule: e.target.checked
                        ? "proportional_reversal"
                        : null,
                    },
                  })
                }
              />
              约定按净商品实收金额计算，核实收款后计提，退款按比例冲回
            </label>
          </>
        )}
        <label className="cn-field">
          <span>协议依据（文件引用或约定说明）</span>
          <textarea
            value={t.agreementEvidence}
            onChange={(e) => terms({ agreementEvidence: e.target.value })}
          />
        </label>
        {links("关联产品", "productIds", state.products)}
        {links("关联渠道", "routeIds", state.routes)}
        {links("关联工单", "workOrderIds", net.workOrders)}
        <p>
          未确定的费用留空；明确免费填
          0。保存为待审核版本，不触发收费或执行授权。
        </p>
        {error && <p role="alert">{error}</p>}
        <button className="cn-button cn-primary" type="submit">
          保存待审核版本
        </button>
      </fieldset>
    </form>
  );
}
export function Mandates({ state, sessionId, onClose, onChanged, initialId }) {
  const lifetime = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const storageKey = `commerce-business-pending:${sessionId}:${state.workspaceId}`;
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    [error, setError] = useState(""),
    [editor, setEditor] = useState(null),
    [review, setReview] = useState(null),
    [selected, setSelected] = useState(initialId || null),
    [partyName, setPartyName] = useState(""),
    [partyType, setPartyType] = useState("factory"),
    [projectName, setProjectName] = useState("");
  const rows = state.commerceNetwork?.salesAuthorizations || [],
    record = rows.find((r) => r.id === selected && r.businessTerms);
  async function send(envelope) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(envelope));
      setPending(envelope);
      const result = stateFrom(
        await callApi("/command", {
          body: envelope,
          signal: lifetime.current?.signal,
        }),
      );
      if (lifetime.current?.signal.aborted) return;
      if (!Number.isSafeInteger(result.revision))
        throw new Error("响应不完整，请使用原请求重试。");
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setEditor(null);
      setReview(null);
      await onChanged(result.projectId);
    } catch (e) {
      if (lifetime.current?.signal.aborted) return;
      if (
        e.status >= 400 &&
        e.status < 500 &&
        !["INVALID_RESPONSE", "RESPONSE_TOO_LARGE"].includes(e.code)
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const command = (name, payload, revision = state.revision) =>
    send({
      sessionId,
      projectId: state.projectId,
      expectedRevision: revision,
      requestId: requestId(),
      command: name,
      payload,
    });
  return (
    <Dialog
      wide
      title="业务委托"
      onClose={() => {
        if (!busy && !pending) onClose();
      }}
      footer={
        <button
          className="cn-button"
          disabled={busy || !!pending}
          onClick={onClose}
        >
          关闭
        </button>
      }
    >
      <div className="cn-business">
        <p>
          同一 Agent 底座，三种业务模式。条款与工单分别审核，所有收费尚未接通。
        </p>
        {error && (
          <p role="alert" className="cn-danger-text">
            {error}
          </p>
        )}
        {pending && (
          <p role="status">
            提交结果尚待核实。请保持原请求重试，避免重复创建。
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
          {!state.projectId ? (
            <>
              <label className="cn-field">
                <span>项目名称</span>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </label>
              <button
                className="cn-button"
                onClick={() =>
                  command("create_project", {
                    title: projectName,
                    goal: "跨境业务委托",
                  })
                }
              >
                创建项目
              </button>
            </>
          ) : (
            <>
              <details>
                <summary>登记委托方或服务方</summary>
                <label className="cn-field">
                  <span>主体名称</span>
                  <input
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                  />
                </label>
                <label className="cn-field">
                  <span>主体类型</span>
                  <select
                    aria-label="主体类型"
                    value={partyType}
                    onChange={(e) => setPartyType(e.target.value)}
                  >
                    <option value="factory">工厂</option>
                    <option value="distributor">渠道商 / 卖家 / Creator</option>
                    <option value="provider">服务方 / 采购代理</option>
                  </select>
                </label>
                <button
                  className="cn-button"
                  onClick={() =>
                    command("upsert_party", {
                      type: partyType,
                      displayName: partyName,
                    })
                  }
                >
                  保存主体
                </button>
              </details>
              <nav className="cn-business-list">
                {rows.map((r) => (
                  <button
                    className="cn-button"
                    key={r.id}
                    disabled={!r.businessTerms}
                    onClick={() => {
                      setSelected(r.id);
                      setEditor(null);
                      setReview(null);
                    }}
                  >
                    {r.title || r.id}
                    {!r.businessTerms
                      ? "（原有销售授权）"
                      : ` · ${STATUSES[r.effectiveStatus || r.status] || r.status}`}
                  </button>
                ))}
                <button
                  className="cn-button cn-primary"
                  onClick={() => {
                    setEditor({ record: null, revision: state.revision });
                    setReview(null);
                  }}
                >
                  新建委托
                </button>
              </nav>
              {editor ? (
                <>
                  <button className="cn-button" onClick={() => setEditor(null)}>
                    返回委托列表
                  </button>
                  <Editor
                    key={editor.record?.id || "new"}
                    record={editor.record}
                    state={state}
                    disabled={busy || !!pending}
                    onSave={(payload) =>
                      command(
                        editor.record
                          ? "amend_business_mandate"
                          : "propose_business_mandate",
                        payload,
                        editor.revision,
                      )
                    }
                  />
                </>
              ) : review ? (
                <>
                  <BusinessSummary
                    record={review.record}
                    state={review.state}
                  />
                  <p>
                    正在确认第 {review.record.businessTerms.version}{" "}
                    版。数据变化时提交会被拒绝，请重新打开核对。
                  </p>
                  <button
                    className="cn-button cn-primary"
                    onClick={() =>
                      command(
                        review.command,
                        { mandateId: review.record.id },
                        review.revision,
                      )
                    }
                  >
                    {review.command === "approve_mandate"
                      ? "确认审核条款"
                      : "确认撤销委托"}
                  </button>
                  <button className="cn-button" onClick={() => setReview(null)}>
                    返回
                  </button>
                </>
              ) : record ? (
                <>
                  <BusinessSummary record={record} state={state} />
                  {record.status !== "revoked" && (
                    <>
                      <button
                        className="cn-button"
                        onClick={() =>
                          setEditor({
                            record: structuredClone(record),
                            revision: state.revision,
                          })
                        }
                      >
                        修改条款
                      </button>
                      {record.status === "proposed" && (
                        <button
                          className="cn-button cn-primary"
                          onClick={() =>
                            setReview({
                              record: structuredClone(record),
                              state: structuredClone(state),
                              revision: state.revision,
                              command: "approve_mandate",
                            })
                          }
                        >
                          核对并审核
                        </button>
                      )}
                      <button
                        className="cn-button"
                        onClick={() =>
                          setReview({
                            record: structuredClone(record),
                            state: structuredClone(state),
                            revision: state.revision,
                            command: "revoke_mandate",
                          })
                        }
                      >
                        撤销委托
                      </button>
                    </>
                  )}
                  <details>
                    <summary>条款历史（{record.history?.length || 0}）</summary>
                    {record.history?.map((h) => (
                      <BusinessSummary
                        key={h.businessTerms.version}
                        record={h}
                        state={state}
                      />
                    ))}
                  </details>
                </>
              ) : (
                <p>选择一份委托查看详情，或新建第一份委托。</p>
              )}
            </>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
