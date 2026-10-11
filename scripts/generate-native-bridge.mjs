import path from 'node:path';
import { open } from 'node:fs/promises';
import { assertPrivateWindowsPath } from '../server/windows-private-acl.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNativeRelayOverlay } from '../server/harness-provider.mjs';
import { createNativeStorageOverlay } from '../server/native-storage.mjs';
import { loadNativeBridgeDependencies } from '../server/native-bridge.mjs';

async function writePrivateOverlay(filename, text) {
  const handle = await open(filename, 'wx', 0o600);
  try {
    await assertPrivateWindowsPath(filename, { initializeEmpty: true });
    await handle.writeFile(text);
    await handle.sync();
  } finally { await handle.close(); }
}

/** Return a reviewable overlay. Never launches a runtime or edits existing profiles. */
export async function generateNativeBridgeOverlay({ sdkPackagePath, outputPath }) {
  if (!path.isAbsolute(outputPath) || !/\.ya?ml$/.test(outputPath)) throw new Error('Use an absolute, new .yml output path.');
  await loadNativeBridgeDependencies(sdkPackagePath);
  const bridge = fileURLToPath(new URL('../server/native-bridge.mjs', import.meta.url));
  const text = '# Generated Workspace bridge overlay. Review before enabling.\n'
    + '# Keeps native tools, Goal, context and persistence under the existing profile.\n'
    + '- id: sdk-jsonrpc-server\n  disabled: true\n'
    + '- insert:\n    - id: workspace-native-bridge\n'
    + `      name: ${JSON.stringify(bridge)}\n`
    + '      inject: [sdkAppStartup, loader, agents, sessionPersistence]\n'
    + `      config:\n        sdkPackagePath: ${JSON.stringify(sdkPackagePath)}\n`;
  await writePrivateOverlay(outputPath, text);
  return { outputPath, bridgePath: bridge };
}

/** Write a new, private relay registration patch. No environment lookup or model call. */
export async function generateNativeRelayOverlay({ outputPath, ...route }) {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || !/\.ya?ml$/.test(outputPath)) {
    throw new Error('Use an absolute, new .yml output path.');
  }
  const overlay = createNativeRelayOverlay(route);
  await writePrivateOverlay(outputPath, JSON.stringify(overlay, null, 2) + '\n');
  return { outputPath, provider: route.nativeProvider, protocol: route.nativeProtocol, model: route.nativeModel };
}

/** Write storage containment settings without changing any existing installation. */
export async function generateNativeStorageOverlay({ dshHome, compression, outputPath }) {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || !/\.ya?ml$/.test(outputPath)) throw new Error('Use an absolute, new .yml output path.');
  const overlay = createNativeStorageOverlay({ dshHome, compression });
  await writePrivateOverlay(outputPath, JSON.stringify(overlay, null, 2) + '\n');
  return { outputPath, compression };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--storage') {
      const [, dshHome, compression, outputPath, ...extra] = args;
      if (!outputPath || extra.length) throw new Error('Invalid arguments');
      await generateNativeStorageOverlay({ dshHome, compression, outputPath });
      process.stdout.write('Storage overlay generated for review only. No runtime or model was started.\n');
    } else if (args[0] === '--relay') {
      const [, nativeProtocol, nativeBaseURL, nativeModel, contextWindow, maxTokens, outputPath, ...extra] = args;
      if (!outputPath || extra.length) throw new Error('Invalid arguments');
      await generateNativeRelayOverlay({ outputPath, nativeProvider: 'workspace-fastaitoken', nativeProtocol,
        nativeBaseURL, nativeModel, nativeApiKeyEnv: 'FASTAITOKEN_API_KEY',
        contextWindow: Number(contextWindow), maxTokens: Number(maxTokens) });
      process.stdout.write('Relay overlay generated for review only. No runtime or model was started.\n');
    } else {
      const [sdkPackagePath, outputPath, ...extra] = args;
      if (!sdkPackagePath || !outputPath || extra.length) throw new Error('Invalid arguments');
      await generateNativeBridgeOverlay({ sdkPackagePath, outputPath });
      process.stdout.write('Bridge overlay generated for review only. No runtime or model was started.\n');
    }
  } catch {
    process.stderr.write('Overlay was not generated. Check reviewed configuration, built SDK exports (bridge only), and a new absolute .yml output filename.\n'
      + 'Bridge usage: node scripts/generate-native-bridge.mjs /absolute/sdk/server/package.json /absolute/new-bridge.patch.yml\n'
      + 'Storage usage: node scripts/generate-native-bridge.mjs --storage /absolute/data/harness none|zstd /absolute/new-storage.patch.yml\n'
      + 'Relay usage: node scripts/generate-native-bridge.mjs --relay PROTOCOL BASE_URL MODEL CONTEXT_WINDOW MAX_TOKENS /absolute/new-relay.patch.yml\n');
    process.exitCode = 1;
  }
}
