// The inquiry-recovery domain's own error type.
//
// It deliberately mirrors the historical `server/runtime.mjs` ApiError shape
// (`status` + `code` own properties, the human message on `message`) so a host
// that already recognizes ApiError can inject its own class through
// `createInquiryRecoveryService({ ApiError })` / `inquiryRecoveryHttp({ ApiError })`
// and keep receiving instances of that exact class.
export class InquiryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export default InquiryError;
