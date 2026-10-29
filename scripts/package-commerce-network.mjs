// Compatibility entry: standalone commerce packaging now also vendors shared contracts.
process.argv.push('--only=dsh-commerce-network');
await import('./package-commerce-business.mjs');
