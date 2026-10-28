import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "./Inspector.jsx";
import { callApi, stateFrom, requestId } from "./api.mjs";
import { STATUSES, timestamp } from "./model.mjs";
import {
  BUSINESS_STAGES,
  PROGRESS_STATUSES,
  linkedWorkIds,
} from "../../../../packages/domain-commerce-network/src/business-progress.mjs";

const initialForm = (m) => ({
  mandateId: m.id,
  expectedProgressRevision: m.progress?.revision || 0,
  stage: m.progress?.stage || "intake",
  status: m.progress?.status || "active",
  responsiblePartyId: m.progress?.responsiblePartyId || m.operatorPartyId,
  nextAction: m.progress?.nextAction || "",
  blocker: m.progress?.blocker || "",
  reason: "",
  workOrderIds: m.progress?.workOrderIds || [],
  outcomeIds: m.progress?.outcomes.map((o) => o.id) || [],
});
const toggle = (ids, id) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
const message = (e) =>
  e.code === "REVISION_CONFLICT"
    ? "数据已更新，请刷新并重新编辑；未覆盖其他人的修改。"
    : e.message || "连接中断，请用原请求核对结果。";

export function BusinessWorkbench({
  state,
  sessionId,
  onClose,
  onChanged,
  onMandate,
  onWork,
  onArtifact,
  onAsk,
  promptPending,
  active = true,
}) {
  const key = `commerce-progress:v1:${sessionId}:${state.workspaceId}:${state.projectId}`;
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  });
  const rows = (state.commerceNetwork?.salesAuthorizations || []).filter(
    (m) => m.businessTerms?.mode === "factory_sales",
  );
  const [selected, setSelected] = useState(
    () => pending?.payload?.mandateId || rows[0]?.id || null,
  );
  const [filter, setFilter] = useState("all"),
    [editor, setEditor] = useState(null),
    [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lifetime = useRef(null),
    lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    lifetime.current = c;
    return () => c.abort();
  }, []);
  const record = rows.find((m) => m.id === selected),
    net = state.commerceNetwork || {};
  const disabled = busy || Boolean(pending),
    party = (id) => net.parties?.find((p) => p.id === id)?.displayName || id;
  const work = record
    ? (net.workOrders || []).filter((o) => linkedWorkIds(record).includes(o.id))
    : [];
  const view = record?.progressView;
  const canEdit = record?.effectiveStatus === "active";
  const frozen = disabled || Boolean(editor);
  const form = editor?.payload;
  const update = (field, value) =>
    setEditor((e) => ({ ...e, payload: { ...e.payload, [field]: value } }));
  const selectedOrders = form
    ? [...new Set([...(record?.workOrderIds || []), ...form.workOrderIds])]
    : [];
  const candidateOutcomes = (state.deliverables || []).filter(
    (d) =>
      selectedOrders.includes(d.orderId) &&
      net.workOrders?.some(
        (o) =>
          o.id === d.orderId &&
          o.status === "accepted" &&
          o.deliverableId === d.id &&
          o.deliverableSha256 === d.sha256,
      ),
  );
  async function send(envelope) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const signal = lifetime.current.signal;
    try {
      sessionStorage.setItem(key, JSON.stringify(envelope));
      setPending(envelope);
      const result = stateFrom(
        await callApi("/command", { body: envelope, signal }),
      );
      if (signal.aborted) return;
      if (!Number.isSafeInteger(result.revision))
        throw Error("响应不完整，请用原请求核对结果。");
      sessionStorage.removeItem(key);
      setPending(null);
      setEditor(null);
      setReview(false);
      await onChanged(result.projectId);
    } catch (e) {
      if (signal.aborted) return;
      if (
        e.status >= 400 &&
        e.status < 500 &&
        !["INVALID_RESPONSE", "RESPONSE_TOO_LARGE"].includes(e.code)
      ) {
        sessionStorage.removeItem(key);
        setPending(null);
        setEditor(null);
        setReview(false);
      }
      setError(message(e));
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  function ask() {
    onAsk(
      {
        id: `business_mandate:${record.id}`,
        refId: record.id,
        kind: "business_mandate",
      },
      `请读取此工厂代运营委托的最新条款、progress 和 progressView，核对当前阶段、阻碍、关联工单与验收成果，给出下一步建议。业务阶段只是运营记录，不证明成交或收款。若需要新增任务，先提议工单并等待独立授权。不要自动派工、发信、报价或扣费。`,
    );
  }
  return (
    <Dialog
      title="工厂代运营工作台"
      wide
      onClose={() => {
        if (!frozen) onClose();
      }}
      footer={
        <button className="cn-button" disabled={frozen} onClick={onClose}>
          返回画布
        </button>
      }
    >
      <div className="cn-workbench">
        <p className="cn-workbench-intro">
          围绕业务委托查看进展、下一步与成果。阶段由运营人员记录，可跳转或回退；不代表已成交或已收款。
        </p>
        {error && (
          <p role="alert" className="cn-inline-error">
            {error}
          </p>
        )}
        {pending && (
          <div className="cn-workbench-pending" role="status">
            <strong>上次提交结果待核对</strong>
            <p>请求已保留，重试会使用同一个请求号与原始内容。</p>
            <button
              className="cn-button"
              disabled={busy}
              onClick={() => send(pending)}
            >
              用原请求核对结果
            </button>
          </div>
        )}
        <div className="cn-workbench-tools">
          <label>
            按阶段筛选
            <select
              aria-label="按阶段筛选"
              disabled={frozen}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setSelected(null);
              }}
            >
              {[["all", "全部阶段"], ...Object.entries(BUSINESS_STAGES)].map(
                ([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            className="cn-button"
            disabled={frozen}
            onClick={() => onChanged(state.projectId)}
          >
            刷新进展
          </button>
        </div>
        <div className="cn-workbench-list" aria-label="工厂委托列表">
          {rows
            .filter(
              (m) =>
                filter === "all" || (m.progress?.stage || "intake") === filter,
            )
            .map((m) => (
              <button
                key={m.id}
                disabled={frozen}
                className={`cn-workbench-card${selected === m.id ? " cn-workbench-selected" : ""}`}
                aria-pressed={selected === m.id}
                onClick={() => setSelected(m.id)}
              >
                <strong>{m.title}</strong>
                <span>
                  {BUSINESS_STAGES[m.progress?.stage || "intake"]} ·{" "}
                  {STATUSES[m.effectiveStatus || m.status] || m.status}
                </span>
                <small>
                  {m.progress
                    ? PROGRESS_STATUSES[m.progress.status]
                    : "尚未记录业务进展"}{" "}
                  · {m.progressView?.decisions.length || 0} 项待处理
                </small>
                <span>{m.progress?.nextAction || "下一步待安排"}</span>
              </button>
            ))}
        </div>
        {!rows.length && (
          <p>暂无工厂代运营委托。先在“业务委托”中创建并审核委托。</p>
        )}
        {record && (
          <section aria-label="委托业务进展">
            <header className="cn-workbench-heading">
              <div>
                <h3>{record.title}</h3>
                <span>
                  {record.marketCode} · 条款 v{record.businessTerms.version} ·
                  进展 #{record.progress?.revision || 0}
                </span>
              </div>
              <button
                className="cn-button"
                disabled={frozen}
                onClick={() => onMandate(record.id)}
              >
                条款与服务账单
              </button>
            </header>
            {view?.needsReview && (
              <p role="status" className="cn-inline-error">
                条款或批准已变更，旧进展保留。请按当前条款重新核对业务进展。
              </p>
            )}
            <ol className="cn-workbench-stages">
              {Object.entries(BUSINESS_STAGES).map(([id, label]) => (
                <li
                  key={id}
                  aria-current={
                    (record.progress?.stage || "intake") === id
                      ? "step"
                      : undefined
                  }
                >
                  {label}
                </li>
              ))}
            </ol>
            <dl className="cn-workbench-facts">
              <dt>负责主体</dt>
              <dd>
                {record.progress
                  ? party(record.progress.responsiblePartyId)
                  : "待安排"}
              </dd>
              <dt>推进状态</dt>
              <dd>
                {record.progress
                  ? PROGRESS_STATUSES[record.progress.status]
                  : "尚未记录"}
              </dd>
              <dt>下一步</dt>
              <dd>{record.progress?.nextAction || "待安排"}</dd>
              <dt>阻碍</dt>
              <dd>{record.progress?.blocker || "未记录"}</dd>
            </dl>
            <div className="cn-workbench-tools">
              <button
                className="cn-button cn-primary"
                disabled={frozen || !canEdit}
                onClick={() => {
                  setError("");
                  setEditor({
                    sessionId,
                    projectId: state.projectId,
                    command: "record_business_progress",
                    expectedRevision: state.revision,
                    requestId: requestId(),
                    payload: initialForm(record),
                  });
                }}
              >
                更新业务进展
              </button>
              <button
                className="cn-button"
                disabled={frozen || promptPending || !active}
                onClick={ask}
              >
                请 Assistant 分析下一步
              </button>
            </div>
            {!canEdit && <p>当前委托未生效、已到期或已撤销，业务进展只读。</p>}
            {editor && (
              <form
                className="cn-workbench-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  setReview(true);
                }}
              >
                {editor.expectedRevision !== state.revision && (
                  <p role="status">
                    页面数据已变化；请取消编辑、刷新后重新核对。
                  </p>
                )}
                <fieldset disabled={disabled || review}>
                  <legend>记录业务进展</legend>
                  <label>
                    业务阶段
                    <select
                      aria-label="业务阶段"
                      value={form.stage}
                      onChange={(e) => update("stage", e.target.value)}
                    >
                      {Object.entries(BUSINESS_STAGES).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    推进状态
                    <select
                      aria-label="推进状态"
                      value={form.status}
                      onChange={(e) => update("status", e.target.value)}
                    >
                      {Object.entries(PROGRESS_STATUSES).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    负责主体
                    <select
                      aria-label="负责主体"
                      value={form.responsiblePartyId}
                      onChange={(e) =>
                        update("responsiblePartyId", e.target.value)
                      }
                    >
                      {(net.parties || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    下一步
                    <textarea
                      aria-label="下一步"
                      required
                      maxLength={1200}
                      value={form.nextAction}
                      onChange={(e) => update("nextAction", e.target.value)}
                    />
                  </label>
                  <label>
                    阻碍
                    <textarea
                      aria-label="阻碍"
                      required={form.status === "blocked"}
                      maxLength={1200}
                      value={form.blocker}
                      onChange={(e) => update("blocker", e.target.value)}
                    />
                  </label>
                  <label>
                    更新依据
                    <textarea
                      aria-label="更新依据"
                      required
                      maxLength={2000}
                      value={form.reason}
                      onChange={(e) => update("reason", e.target.value)}
                    />
                  </label>
                  <h4>补充关联工单</h4>
                  <p>只建立业务关联，工单授权和执行状态保持独立。</p>
                  {(net.workOrders || []).map((o) => (
                    <label className="cn-workbench-check" key={o.id}>
                      <input
                        type="checkbox"
                        checked={selectedOrders.includes(o.id)}
                        disabled={record.workOrderIds?.includes(o.id)}
                        onChange={() => {
                          const ids = toggle(form.workOrderIds, o.id);
                          setEditor((e) => ({
                            ...e,
                            payload: {
                              ...e.payload,
                              workOrderIds: ids,
                              outcomeIds: e.payload.outcomeIds.filter((id) =>
                                state.deliverables?.some(
                                  (d) =>
                                    d.id === id &&
                                    [
                                      ...(record.workOrderIds || []),
                                      ...ids,
                                    ].includes(d.orderId),
                                ),
                              ),
                            },
                          }));
                        }}
                      />
                      {o.title} · {STATUSES[o.status] || o.status}
                    </label>
                  ))}
                  <h4>本次引用的已验收成果</h4>
                  {candidateOutcomes.length ? (
                    candidateOutcomes.map((d) => (
                      <label className="cn-workbench-check" key={d.id}>
                        <input
                          type="checkbox"
                          checked={form.outcomeIds.includes(d.id)}
                          onChange={() =>
                            update("outcomeIds", toggle(form.outcomeIds, d.id))
                          }
                        />
                        {d.title}
                      </label>
                    ))
                  ) : (
                    <p>关联工单尚无已验收成果，可先记录进展与阻碍。</p>
                  )}
                </fieldset>
                {review ? (
                  <div className="cn-workbench-review">
                    <h4>确认此次记录</h4>
                    <p>
                      {BUSINESS_STAGES[form.stage]} ·{" "}
                      {PROGRESS_STATUSES[form.status]} ·{" "}
                      {party(form.responsiblePartyId)}
                    </p>
                    <p>下一步：{form.nextAction}</p>
                    <p>依据：{form.reason}</p>
                    <p>
                      关联工单 {selectedOrders.length} 项，引用已验收成果{" "}
                      {form.outcomeIds.length}{" "}
                      项。本次保存不触发执行、发信、成交或收费。
                    </p>
                    <button
                      type="button"
                      className="cn-button"
                      disabled={disabled}
                      onClick={() => setReview(false)}
                    >
                      返回修改
                    </button>
                    <button
                      type="button"
                      className="cn-button cn-primary"
                      disabled={
                        disabled || editor.expectedRevision !== state.revision
                      }
                      onClick={() => send(editor)}
                    >
                      确认保存进展
                    </button>
                  </div>
                ) : (
                  <button
                    className="cn-button cn-primary"
                    type="submit"
                    disabled={
                      disabled || editor.expectedRevision !== state.revision
                    }
                  >
                    核对更新
                  </button>
                )}
                <button
                  className="cn-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setEditor(null);
                    setReview(false);
                  }}
                >
                  取消编辑
                </button>
              </form>
            )}
            <h4>待处理事项</h4>
            {view?.decisions.length ? (
              view.decisions.map((o) => (
                <button
                  className="cn-workbench-row"
                  disabled={frozen}
                  key={o.id}
                  onClick={() => onWork(o.id)}
                >
                  <span>{o.title}</span>
                  <b>
                    {o.status === "proposed"
                      ? "待授权"
                      : o.status === "delivered"
                        ? "待验收"
                        : o.status === "stop_requested"
                          ? "待停止确认"
                          : "执行失败待核对"}
                  </b>
                </button>
              ))
            ) : (
              <p>关联工单暂无待处理事项。</p>
            )}
            <h4>关联工单与交付</h4>
            {work.map((o) => (
              <button
                className="cn-workbench-row"
                disabled={frozen}
                key={o.id}
                onClick={() => onWork(o.id)}
              >
                <span>{o.title}</span>
                <b>{STATUSES[o.status] || o.status}</b>
              </button>
            ))}
            {view?.deliveries.map((d) => (
              <button
                className="cn-workbench-row"
                disabled={frozen}
                key={d.id}
                onClick={() => onArtifact(d)}
              >
                <span>{d.title}</span>
                <b>{d.accepted ? "已验收成果" : "交付待核对"}</b>
              </button>
            ))}
            <h4>进展历史</h4>
            {record.progressHistory?.length ? (
              [...record.progressHistory].reverse().map((h) => (
                <details className="cn-workbench-history" key={h.eventId}>
                  <summary>
                    #{h.revision} · {BUSINESS_STAGES[h.stage]} ·{" "}
                    {timestamp(h.recordedAt)}
                  </summary>
                  <p>
                    条款 v{h.termsVersion} · {PROGRESS_STATUSES[h.status]} ·{" "}
                    {party(h.responsiblePartyId)}
                  </p>
                  <p>依据：{h.reason}</p>
                  <p>下一步：{h.nextAction}</p>
                  {h.blocker && <p>阻碍：{h.blocker}</p>}
                  <p>记录人：{h.actor}</p>
                  {h.outcomes.map((d) => (
                    <p key={d.id}>
                      {d.title} · SHA-256 {d.sha256}
                    </p>
                  ))}
                </details>
              ))
            ) : (
              <p>尚无进展记录。历史委托不会自动补造进展。</p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
