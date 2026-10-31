// Cross-platform replacement for the Unix `cp -r` steps in the build script.
// Next's `output: standalone` emits a minimal server bundle that does NOT include
// .next/static or public/, so they must be copied in. The old script used
// `cp -r`, which does not exist on Windows (Bun has no coreutils) — the build
// then exited non-zero and start-windows.bat treated it as a failed build and
// served a STALE bundle. This script does the same copy on every OS.
import { cpSync, existsSync, mkdirSync } from 'node:fs'

const standalone = '.next/standalone'
if (!existsSync(`${standalone}/server.js`)) {
  console.error('[postbuild] .next/standalone/server.js missing — is output:"standalone" set in next.config?')
  process.exit(1)
}
mkdirSync(`${standalone}/.next`, { recursive: true })
cpSync('.next/static', `${standalone}/.next/static`, { recursive: true })
cpSync('public', `${standalone}/public`, { recursive: true })
console.log('[postbuild] copied .next/static + public into .next/standalone')
