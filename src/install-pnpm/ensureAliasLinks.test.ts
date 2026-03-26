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
  // Only the pnpm binary exists — pn/pnpx/pnx may not exist after self-update
  await writeFile(path.join(exeDir, 'pnpm'), '#!/bin/sh\necho pnpm\n', { mode: 0o755 })
}

async function setupNonStandaloneFixture (binDir: string): Promise<void> {
  const pnpmBinDir = path.join(binDir, '..', 'pnpm', 'bin')
  await mkdir(pnpmBinDir, { recursive: true })
  await writeFile(path.join(pnpmBinDir, 'pnpm.cjs'), 'console.log("pnpm")\n')
}

describe('ensureAliasLinks', () => {
  let binDir: string

  beforeEach(async () => {
    const tmpDir = await createTempDir()
    binDir = path.join(tmpDir, 'node_modules', '.bin')
    await mkdir(binDir, { recursive: true })
  })

  describe('standalone mode', () => {
    it('creates pn as symlink to pnpm binary on unix', async () => {
      await setupStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, true, 'linux')

      const pnTarget = await readlink(path.join(binDir, 'pn'))
      expect(pnTarget).toBe(path.join('..', '@pnpm', 'exe', 'pnpm'))
    })

    it('creates pnpx and pnx as shell scripts calling pnpm dlx on unix', async () => {
      await setupStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, true, 'linux')

      for (const name of ['pnpx', 'pnx']) {
        const content = await readFile(path.join(binDir, name), 'utf8')
        expect(content).toContain('pnpm')
        expect(content).toContain('dlx')
        expect(content).toContain('exec')
      }
    })

    it('creates .cmd and .ps1 shims on windows', async () => {
      await setupStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, true, 'win32')

      // pn shims
      const pnCmd = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(pnCmd).toContain('pnpm')
      expect(pnCmd).toContain('%*')
      expect(pnCmd).not.toContain('dlx')

      const pnPs1 = await readFile(path.join(binDir, 'pn.ps1'), 'utf8')
      expect(pnPs1).toContain('pnpm')
      expect(pnPs1).toContain('@args')

      // pnpx/pnx shims call pnpm dlx
      const pnpxCmd = await readFile(path.join(binDir, 'pnpx.cmd'), 'utf8')
      expect(pnpxCmd).toContain('pnpm')
      expect(pnpxCmd).toContain('dlx')

      // Should not create extensionless files on windows
      expect(existsSync(path.join(binDir, 'pn'))).toBe(false)
    })
  })

  describe('non-standalone mode', () => {
    it('creates pn as symlink to pnpm.cjs on unix', async () => {
      await setupNonStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, false, 'linux')

      const pnTarget = await readlink(path.join(binDir, 'pn'))
      expect(pnTarget).toBe(path.join('..', 'pnpm', 'bin', 'pnpm.cjs'))
    })

    it('creates pnpx/pnx scripts on unix', async () => {
      await setupNonStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, false, 'linux')

      const content = await readFile(path.join(binDir, 'pnpx'), 'utf8')
      expect(content).toContain('pnpm.cjs')
      expect(content).toContain('dlx')
    })

    it('creates .cmd shims on windows', async () => {
      await setupNonStandaloneFixture(binDir)

      await ensureAliasLinks(binDir, false, 'win32')

      const cmdContent = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(cmdContent).toContain(path.join('pnpm', 'bin', 'pnpm.cjs'))
    })
  })

  describe('skips when pnpm binary does not exist', () => {
    it('creates no links on unix', async () => {
      await ensureAliasLinks(binDir, true, 'linux')

      expect(existsSync(path.join(binDir, 'pn'))).toBe(false)
      expect(existsSync(path.join(binDir, 'pnpx'))).toBe(false)
      expect(existsSync(path.join(binDir, 'pnx'))).toBe(false)
    })

    it('creates no shims on windows', async () => {
      await ensureAliasLinks(binDir, true, 'win32')

      expect(existsSync(path.join(binDir, 'pn.cmd'))).toBe(false)
    })
  })

  describe('self-update bin directory (pnpm shim in same dir)', () => {
    it('creates aliases using pnpm shim in the same directory on unix', async () => {
      // self-update creates a pnpm shim in $PNPM_HOME/bin/ — no package dir
      await writeFile(path.join(binDir, 'pnpm'), '#!/bin/sh\nexec /path/to/real/pnpm "$@"\n', { mode: 0o755 })

      await ensureAliasLinks(binDir, true, 'linux')

      const pnTarget = await readlink(path.join(binDir, 'pn'))
      expect(pnTarget).toBe('pnpm')

      const pnxContent = await readFile(path.join(binDir, 'pnx'), 'utf8')
      expect(pnxContent).toContain('pnpm')
      expect(pnxContent).toContain('dlx')
    })

    it('creates .cmd shims using pnpm in same dir on windows', async () => {
      await writeFile(path.join(binDir, 'pnpm'), 'pnpm binary')

      await ensureAliasLinks(binDir, true, 'win32')

      const cmdContent = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(cmdContent).toContain('pnpm')
    })
  })

  describe('overwrites existing broken shims', () => {
    it('replaces npm broken shim with symlink on unix', async () => {
      await setupStandaloneFixture(binDir)
      // Simulate npm's broken shim pointing to .tools/ placeholder
      await writeFile(path.join(binDir, 'pn'), '#!/bin/sh\nexec .tools/broken "$@"\n')

      await ensureAliasLinks(binDir, true, 'linux')

      const target = await readlink(path.join(binDir, 'pn'))
      expect(target).toBe(path.join('..', '@pnpm', 'exe', 'pnpm'))
    })

    it('replaces existing .cmd shims on windows', async () => {
      await setupStandaloneFixture(binDir)
      await writeFile(path.join(binDir, 'pn.cmd'), 'broken shim')

      await ensureAliasLinks(binDir, true, 'win32')

      const content = await readFile(path.join(binDir, 'pn.cmd'), 'utf8')
      expect(content).toContain('pnpm')
    })
  })
})
