import { unlink, writeFile, symlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

function shScript (command: string): string {
  return `#!/bin/sh\nexec ${command} "$@"\n`
}

function cmdShim (command: string): string {
  return `@ECHO off\r\n${command} %*\r\n`
}

function pwshShim (command: string): string {
  return `#!/usr/bin/env pwsh\n${command} @args\n`
}

async function forceSymlink (target: string, linkPath: string): Promise<void> {
  try { await unlink(linkPath) } catch {}
  await symlink(target, linkPath)
}

async function forceWriteFile (filePath: string, content: string, mode?: number): Promise<void> {
  try { await unlink(filePath) } catch {}
  await writeFile(filePath, content, { mode })
}

/**
 * Create pn/pnpx/pnx alias links in the bin directory.
 *
 * pn is an alias for pnpm, so it symlinks (or shims) to the pnpm binary.
 * pnpx/pnx are aliases for "pnpm dlx", created as shell scripts.
 *
 * This does NOT rely on the @pnpm/exe package having pn/pnx files, because
 * pnpm self-update only replaces the pnpm binary — it doesn't update other
 * files in the package. The aliases are created by pointing pn directly to
 * the pnpm binary, and pnpx/pnx as scripts that exec "pnpm dlx".
 *
 * Only creates links when the pnpm binary exists in the expected location
 * (i.e. the package has been installed). This is always true after bootstrap.
 */
export async function ensureAliasLinks (binDir: string, standalone: boolean, platform: NodeJS.Platform = process.platform): Promise<void> {
  const isWindows = platform === 'win32'

  // Determine the pnpm binary path relative to binDir
  const pnpmTarget = standalone
    ? path.join('..', '@pnpm', 'exe', 'pnpm')
    : path.join('..', 'pnpm', 'bin', 'pnpm.cjs')

  const resolvedPnpm = path.resolve(binDir, pnpmTarget)
  if (!existsSync(resolvedPnpm)) return

  if (isWindows) {
    // pn → calls pnpm directly
    await writeFile(path.join(binDir, 'pn.cmd'), cmdShim(`"%~dp0\\${pnpmTarget}"`))
    await writeFile(path.join(binDir, 'pn.ps1'), pwshShim(`& "$PSScriptRoot\\${pnpmTarget}"`))
    // pnpx/pnx → calls pnpm dlx
    for (const name of ['pnpx', 'pnx']) {
      await writeFile(path.join(binDir, `${name}.cmd`), cmdShim(`"%~dp0\\${pnpmTarget}" dlx`))
      await writeFile(path.join(binDir, `${name}.ps1`), pwshShim(`& "$PSScriptRoot\\${pnpmTarget}" dlx`))
    }
  } else {
    // pn → symlink to pnpm binary
    await forceSymlink(pnpmTarget, path.join(binDir, 'pn'))
    // pnpx/pnx → shell scripts that exec pnpm dlx
    for (const name of ['pnpx', 'pnx']) {
      const pnpmPath = `"$(dirname "$0")/${pnpmTarget}"`
      await forceWriteFile(path.join(binDir, name), shScript(`${pnpmPath} dlx`), 0o755)
    }
  }
}
