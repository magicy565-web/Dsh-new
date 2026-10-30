// Authenticated native Billing requests. No external transaction adapter.
export async function billingApi(path, { body, signal } = {}) {
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
