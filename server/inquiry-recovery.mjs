// Compatibility shim for the extracted historical-inquiry-recovery domain.
//
// The implementation now lives in packages/domain-inquiry-recovery. This module
// keeps the historical public surface for existing callers (server/index.mjs and
// the original recovery test suites) and injects runtime.mjs's ApiError by
// default, so every thrown domain error remains an instance of the class the
// Host serializes. New code should import the package directly.
import { ApiError } from './runtime.mjs';
import {
  createInquiryRecoveryService as createPackageService,
  inquiryRecoveryHttp as packageInquiryRecoveryHttp,
  parseCsv as packageParseCsv,
  InquiryError,
} from '../packages/domain-inquiry-recovery/src/index.mjs';

/** Rebuild an error thrown by the package's default class as the legacy ApiError. */
function asLegacyError(error) {
  if (!(error instanceof InquiryError)) return error;
  const converted = new ApiError(error.status, error.code, error.message);
  for (const key of Object.keys(error)) if (!Object.hasOwn(converted, key)) converted[key] = error[key];
  return converted;
}

/**
 * Injection point for the Host's error class. Callers may still pass their own
 * `ApiError`; when omitted, runtime.mjs's class is used so existing `instanceof
 * ApiError` handling in server/index.mjs keeps working.
 */
export function createInquiryRecoveryService(options = {}) {
  return createPackageService({ ...options, ApiError: options.ApiError ?? ApiError });
}

/** Same public export as before: parser errors keep the Host's ApiError class. */
export function parseCsv(source) {
  try {
    return packageParseCsv(source);
  } catch (error) {
    throw asLegacyError(error);
  }
}

/** Same public export as before, with the Host error class for path errors too. */
export async function inquiryRecoveryHttp(options = {}) {
  try {
    return await packageInquiryRecoveryHttp({ ...options, ApiError: options.ApiError ?? ApiError });
  } catch (error) {
    throw asLegacyError(error);
  }
}
