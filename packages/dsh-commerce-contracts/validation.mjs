import { createHash } from "node:crypto";
export class BusinessError extends Error {
  constructor(code, message = code, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
    Object.defineProperty(this, Symbol.for("dsh.business.error.v1"), {
      value: true,
    });
  }
}
export const isBusinessError = (e) =>
  e instanceof Error &&
  e[Symbol.for("dsh.business.error.v1")] === true &&
  typeof e.code === "string" &&
  /^[A-Z_]+$/.test(e.code) &&
  Number.isInteger(e.status) &&
  e.status >= 400 &&
  e.status <= 599;
export const fail = (code, message, status) => {
  throw new BusinessError(code, message, status);
};
export function keys(value, allowed) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail("INPUT", "Unsupported object fields", 400);
}
export const text = (v, field, max = 2000) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail("INPUT", `Invalid ${field}`, 400);
  return v;
};
export const id = (v, field = "id") => {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v))
    fail("INPUT", `Invalid ${field}`, 400);
  return v;
};
export const integer = (v, field, min = 0, max = 1e9) => {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    fail("INPUT", `Invalid ${field}`, 400);
  return v;
};
export const iso = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail("INPUT", "ISO timestamp required", 400);
  return new Date(v).toISOString();
};
export const canonical = (v) => JSON.stringify(normalize(v));
function normalize(v) {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, normalize(v[k])]),
        )
      : v;
}
export const sha = (v) =>
  createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : canonical(v))
    .digest("hex");
export const hash = (v) => {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    fail("INPUT", "SHA-256 required");
  return v;
};
export const dependency = (get, name) => {
  const s = get();
  if (!s) fail("DEPENDENCY_MISSING", `${name} is not installed`, 503);
  return s;
};
