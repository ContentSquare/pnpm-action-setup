import { writeFile, symlink } from 'fs/promises'
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

/**
 * Create pn/pnpx/pnx alias links in the bin directory.
 * On Unix, creates symlinks. On Windows, creates .cmd and .ps1 shims.
 * Only creates links when the target file actually exists (pnpm v11+).
 */
export async function ensureAliasLinks (binDir: string, standalone: boolean, platform: NodeJS.Platform = process.platform): Promise<void> {
  const aliases = getAliases(standalone)
  const isWindows = platform === 'win32'

  for (const { name, target } of aliases) {
    const resolvedTarget = path.resolve(binDir, target)
    if (!existsSync(resolvedTarget)) continue

    if (isWindows) {
      const cmdPath = path.join(binDir, `${name}.cmd`)
      if (!existsSync(cmdPath)) {
        await writeFile(cmdPath, cmdShim(target))
      }
      const ps1Path = path.join(binDir, `${name}.ps1`)
      if (!existsSync(ps1Path)) {
        await writeFile(ps1Path, pwshShim(target))
      }
    } else {
      const link = path.join(binDir, name)
      if (!existsSync(link)) {
        await symlink(target, link)
      }
    }
  }
}
