// Preload only. The original official CLI remains the actual main program.
globalThis.fetch=async()=>{throw Error('NATIVE_PREVIEW_NETWORK_DISABLED');};
