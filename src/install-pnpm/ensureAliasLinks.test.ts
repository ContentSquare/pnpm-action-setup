import { describe, it, expect, beforeEach } from 'vitest'
import { ensureAliasLinks } from './ensureAliasLinks'
import { mkdtemp, mkdir, writeFile, readFile, readlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

async function createTempDir (): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'alias-links-test-'))
}

async function setupStandaloneFixture (binDir: string): Promise<void> {
  const exeDir = path.join(binDir, '..', '@pnpm', 'exe')
  await mkdir(exeDir, { recursive: true })
  await writeFile(path.join(exeDir, 'pn'), '#!/bin/sh\necho pn\n', { mode: 0o755 })
  await writeFile(path.join(exeDir, 'pnpx'), '#!/bin/sh\necho pnpx\n', { mode: 0o755 })
  await writeFile(path.join(exeDir, 'pnx'), '#!/bin/sh\necho pnx\n', { mode: 0o755 })
}

async function setupNonStandaloneFixture (binDir: string): Promise<void> {
  const pnpmBinDir = path.join(binDir, '..', 'pnpm', 'bin')
  await mkdir(pnpmBinDir, { recursive: true })
  await writeFile(path.join(pnpmBinDir, 'pnpm.cjs'), 'console.log("pnpm")\n')
  await writeFile(path.join(pnpmBinDir, 'pnpx.cjs'), 'console.log("pnpx")\n')
}

describe('ensureAliasLinks', () => {
  let binDir: string

  beforeEach(async () => {
    const tmpDir = await createTempDir()
    binDir = path.join(tmpDir, 'node_modules', '.bin')
    await mkdir(binDir, { recursive: true })
  })

  describe('standalone mode', () => {
    it('creates symlinks on unix when targets exist', async () => {
      await setupStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, true, 'linux')

      expect(existsSync(path.join(binDir, 'pn'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pnpx'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pnx'))).toBe(true)

      const pnTarget = await readlink(path.join(binDir, 'pn'))
      expect(pnTarget).toBe(path.join('..', '@pnpm', 'exe', 'pn'))
    })

    it('creates .cmd and .ps1 shims on windows when targets exist', async () => {
      await setupStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, true, 'win32')

      // Should create .cmd shims, not extensionless symlinks
      expect(existsSync(path.join(binDir, 'pn.cmd'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pnx.cmd'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pn.ps1'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pnx.ps1'))).toBe(true)

      // Should not create extensionless symlinks on windows
      expect(existsSync(path.join(binDir, 'pn'))).toBe(false)
      expect(existsSync(path.join(binDir, 'pnx'))).toBe(false)

      const cmdContent = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(cmdContent).toContain(path.join('..', '@pnpm', 'exe', 'pn'))
      expect(cmdContent).toContain('%*')

      const ps1Content = await readFile(path.join(binDir, 'pn.ps1'), 'utf8')
      expect(ps1Content).toContain(path.join('..', '@pnpm', 'exe', 'pn'))
      expect(ps1Content).toContain('@args')
    })
  })

  describe('non-standalone mode', () => {
    it('creates symlinks on unix when targets exist', async () => {
      await setupNonStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, false, 'linux')

      expect(existsSync(path.join(binDir, 'pn'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pnpx'))).toBe(true)
      expect(existsSync(path.join(binDir, 'pnx'))).toBe(true)

      const pnTarget = await readlink(path.join(binDir, 'pn'))
      expect(pnTarget).toBe(path.join('..', 'pnpm', 'bin', 'pnpm.cjs'))

      // pnx should point to pnpx.cjs (same as pnpx)
      const pnxTarget = await readlink(path.join(binDir, 'pnx'))
      expect(pnxTarget).toBe(path.join('..', 'pnpm', 'bin', 'pnpx.cjs'))
    })

    it('creates .cmd shims on windows when targets exist', async () => {
      await setupNonStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, false, 'win32')

      expect(existsSync(path.join(binDir, 'pn.cmd'))).toBe(true)

      const cmdContent = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(cmdContent).toContain(path.join('..', 'pnpm', 'bin', 'pnpm.cjs'))
    })
  })

  describe('skips when targets do not exist', () => {
    it('creates no links when target directory is empty (v10)', async () => {
      // Don't create any fixture files — simulates pnpm v10 without aliases

      await ensureAliasLinks(binDir, true, 'linux')

      expect(existsSync(path.join(binDir, 'pn'))).toBe(false)
      expect(existsSync(path.join(binDir, 'pnpx'))).toBe(false)
      expect(existsSync(path.join(binDir, 'pnx'))).toBe(false)
    })

    it('creates no shims on windows when targets do not exist', async () => {
      await ensureAliasLinks(binDir, true, 'win32')

      expect(existsSync(path.join(binDir, 'pn.cmd'))).toBe(false)
      expect(existsSync(path.join(binDir, 'pnx.cmd'))).toBe(false)
    })
  })

  describe('does not overwrite existing links', () => {
    it('preserves existing symlinks on unix', async () => {
      await setupStandaloneFixture(binDir)
      await writeFile(path.join(binDir, 'pn'), 'existing content')

      await ensureAliasLinks(binDir, true, 'linux')

      const content = await readFile(path.join(binDir, 'pn'), 'utf8')
      expect(content).toBe('existing content')
    })

    it('preserves existing .cmd shims on windows', async () => {
      await setupStandaloneFixture(binDir)
      await writeFile(path.join(binDir, 'pn.cmd'), 'existing shim')

      await ensureAliasLinks(binDir, true, 'win32')

      const content = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(content).toBe('existing shim')
    })
  })
})
