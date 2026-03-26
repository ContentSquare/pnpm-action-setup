import { unlink, writeFile, symlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

interface AliasDefinition {
  name: string
  target: string
}

function getAliases (standalone: boolean): AliasDefinition[] {
  if (standalone) {
    return [
      { name: 'pn', target: path.join('..', '@pnpm', 'exe', 'pn') },
      { name: 'pnpx', target: path.join('..', '@pnpm', 'exe', 'pnpx') },
      { name: 'pnx', target: path.join('..', '@pnpm', 'exe', 'pnx') },
    ]
  }
  return [
    { name: 'pn', target: path.join('..', 'pnpm', 'bin', 'pnpm.cjs') },
    { name: 'pnpx', target: path.join('..', 'pnpm', 'bin', 'pnpx.cjs') },
    { name: 'pnx', target: path.join('..', 'pnpm', 'bin', 'pnpx.cjs') },
  ]
}

function cmdShim (target: string): string {
  return `@ECHO off\r\n"%~dp0\\${target}" %*\r\n`
}

function pwshShim (target: string): string {
  return `#!/usr/bin/env pwsh\n& "$PSScriptRoot\\${target}" @args\n`
}

async function forceSymlink (target: string, linkPath: string): Promise<void> {
  try { await unlink(linkPath) } catch {}
  await symlink(target, linkPath)
}

/**
 * Create pn/pnpx/pnx alias links in the bin directory.
 * On Unix, creates symlinks. On Windows, creates .cmd and .ps1 shims.
 * Only creates links when the target file actually exists (pnpm v11+).
 *
 * Existing links are always replaced because npm may have created shims
 * pointing to an isolated .tools/ copy that has stale placeholder files.
 */
export async function ensureAliasLinks (binDir: string, standalone: boolean, platform: NodeJS.Platform = process.platform): Promise<void> {
  const aliases = getAliases(standalone)
  const isWindows = platform === 'win32'

  for (const { name, target } of aliases) {
    const resolvedTarget = path.resolve(binDir, target)
    if (!existsSync(resolvedTarget)) continue

    if (isWindows) {
      await writeFile(path.join(binDir, `${name}.cmd`), cmdShim(target))
      await writeFile(path.join(binDir, `${name}.ps1`), pwshShim(target))
    } else {
      await forceSymlink(target, path.join(binDir, name))
    }
  }
}
