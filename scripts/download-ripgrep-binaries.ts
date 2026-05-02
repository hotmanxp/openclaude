/**
 * 下载预编译的 ripgrep 二进制文件到 vendor/ripgrep 目录。
 *
 * 用法: bun run download:ripgrep
 *
 * 参考: gemini-cli 的 scripts/download-ripgrep-binaries.ts
 */

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'ripgrep')
const VERSION = 'v13.0.0-10'

interface Target {
  platform: string
  arch: string
  file: string
}

const targets: Target[] = [
  { platform: 'darwin', arch: 'arm64', file: 'aarch64-apple-darwin.tar.gz' },
  { platform: 'darwin', arch: 'x64', file: 'x86_64-apple-darwin.tar.gz' },
  {
    platform: 'linux',
    arch: 'arm64',
    file: 'aarch64-unknown-linux-gnu.tar.gz',
  },
  { platform: 'linux', arch: 'x64', file: 'x86_64-unknown-linux-musl.tar.gz' },
  { platform: 'win32', arch: 'x64', file: 'x86_64-pc-windows-msvc.zip' },
]

async function downloadBinary() {
  await fsPromises.mkdir(VENDOR_DIR, { recursive: true })

  for (const target of targets) {
    const url = `https://github.com/microsoft/ripgrep-prebuilt/releases/download/${VERSION}/ripgrep-${VERSION}-${target.file}`
    const archivePath = path.join(VENDOR_DIR, target.file)
    const binName = `rg-${target.platform}-${target.arch}${target.platform === 'win32' ? '.exe' : ''}`
    const finalBinPath = path.join(VENDOR_DIR, binName)

    if (existsSync(finalBinPath)) {
      console.log(`[Cache] ${binName} already exists.`)
      continue
    }

    console.log(`[Download] ${url}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error(`Response body is null for ${url}`)
    }

    const fileStream = createWriteStream(archivePath)
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      fileStream,
    )

    console.log(`[Extract] Extracting ${archivePath}...`)
    if (target.file.endsWith('.tar.gz')) {
      execFileSync('tar', ['-xzf', archivePath, '-C', VENDOR_DIR])
      const sourceBin = path.join(VENDOR_DIR, 'rg')
      if (existsSync(sourceBin)) {
        await fsPromises.rename(sourceBin, finalBinPath)
      } else {
        const extractedDirName = `ripgrep-${VERSION}-${target.file.replace('.tar.gz', '')}`
        const fallbackSourceBin = path.join(VENDOR_DIR, extractedDirName, 'rg')
        if (existsSync(fallbackSourceBin)) {
          await fsPromises.rename(fallbackSourceBin, finalBinPath)
          await fsPromises.rm(path.join(VENDOR_DIR, extractedDirName), {
            recursive: true,
            force: true,
          })
        } else {
          throw new Error(`Could not find extracted 'rg' binary for ${target.platform} ${target.arch}`)
        }
      }
    } else if (target.file.endsWith('.zip')) {
      execFileSync('tar', ['-xzf', archivePath, '-C', VENDOR_DIR])
      const sourceBin = path.join(VENDOR_DIR, 'rg.exe')
      if (existsSync(sourceBin)) {
        await fsPromises.rename(sourceBin, finalBinPath)
      } else {
        const extractedDirName = `ripgrep-${VERSION}-${target.file.replace('.zip', '')}`
        const fallbackSourceBin = path.join(VENDOR_DIR, extractedDirName, 'rg.exe')
        if (existsSync(fallbackSourceBin)) {
          await fsPromises.rename(fallbackSourceBin, finalBinPath)
          await fsPromises.rm(path.join(VENDOR_DIR, extractedDirName), {
            recursive: true,
            force: true,
          })
        } else {
          throw new Error(`Could not find extracted 'rg.exe' binary for ${target.platform} ${target.arch}`)
        }
      }
    }

    await fsPromises.unlink(archivePath)
    console.log(`[Success] ${binName}`)
  }
}

downloadBinary().catch((err) => {
  console.error(err)
  process.exit(1)
})
