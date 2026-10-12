# Current small integration evidence, not a final package

Executable combination `18e3b07aa6a1297e5258a55e83e2fb8af9c48d05`, pushed and remote-checked. The two images are actual original Page/Component/WXML/WXSS limited Chromium runs from 2026-10-12 19:40 UTC, signed local Workspace HTTP and synthetic Shopify responses; no actual WeChat engine/device, live Shopify or real model. `publication-browser.json` records this source and nine checked paths, one fixture draft/create/upload/publication and zero page errors. The only model response is explicitly the Pi faux fixture. These are successful rerun screenshots, not an official result or a screenshot of a failing assertion.

The first publication UI run on `7289e54` completed all business assertions but exited 1 after printing the result:

```text
page.evaluate: Target page, context or browser has been closed
    at /workspace/wechat-client/miniprogram/test/publication-browser.mjs:15:176
Node.js v24.19.0
```

This error text is transcribed from the execution tool's captured output; it is not labelled an original retained stdout file. `onUnload` cleared readiness and queued a final source render, while cleanup closed Chromium before that render completed. The fixed driver awaits the existing render queue before closing, without suppressing errors or removing assertions. It also clears its local fixture publication cache before reentry so readback must come from the original HTTP state. Both publication and first-notification reruns exited 0 on `18e3b07`.

Historical tracked screenshots and the 18:56 fixed packages are preserved. Current raw runtime logs are under untracked `miniprogram/evidence/shop-readiness/`, and the new browser output directories are distinct from historical evidence. Final same-source archives/screenshots remain deferred to the agreed unified freeze.
