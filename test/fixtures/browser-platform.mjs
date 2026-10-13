import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream,
  ByteLengthQueuingStrategy, CountQueuingStrategy } from 'node:stream/web';

/** Install Node 24's real WHATWG platform APIs in the separate JSDOM realm.
 * This does not replace fetch, HTTP, Store, model providers or business DTOs.
 * JSDOM supplies no geometry; the explicit no-layout shims below only allow
 * browser components to mount. Actual layout/scroll acceptance uses Chromium.
 */
export function installBrowserPlatform(window) {
  Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });
  Object.assign(window, { TextEncoder, TextDecoder, ReadableStream, WritableStream, TransformStream,
    TextEncoderStream, TextDecoderStream, ByteLengthQueuingStrategy, CountQueuingStrategy,
    AbortController, AbortSignal, Request, Response, Headers, structuredClone });
  window.matchMedia ||= () => ({ matches: false, media: '', onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
  window.ResizeObserver ||= class JsdomNoLayoutResizeObserver {
    observe() {} unobserve() {} disconnect() {}
  };
  window.HTMLElement.prototype.scrollIntoView ||= function jsdomNoLayoutScrollIntoView() {};
  window.HTMLElement.prototype.scrollTo ||= function jsdomNoLayoutScrollTo(options) {
    if (typeof options === 'object' && options !== null && typeof options.top === 'number') this.scrollTop = options.top;
  };
}
