/**
 * Copy assets to dist/bundle/ for distribution.
 * These assets are loaded at runtime from the bundle directory.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const distBundleDir = join(rootDir, 'dist', 'bundle')

// Ensure bundle directory exists
if (!existsSync(distBundleDir)) {
  mkdirSync(distBundleDir, { recursive: true })
}

// 1. Copy built-in skills (src/skills/bundled/)
const skillsSrc = join(rootDir, 'src', 'skills', 'bundled')
const skillsDest = join(distBundleDir, 'skills')
if (existsSync(skillsSrc)) {
  cpSync(skillsSrc, skillsDest, { recursive: true, dereference: true })
  console.log('Copied built-in skills to dist/bundle/skills/')
} else {
  console.warn('Warning: built-in skills not found at src/skills/bundled/')
}

// 2. Copy documentation (docs/)
const docsSrc = join(rootDir, 'docs')
const docsDest = join(distBundleDir, 'docs')
if (existsSync(docsSrc)) {
  cpSync(docsSrc, docsDest, { recursive: true, dereference: true })
  console.log('Copied docs to dist/bundle/docs/')
} else {
  console.warn('Warning: docs directory not found')
}

// 3. Copy prompts directory if it exists (src/prompts/)
const promptsSrc = join(rootDir, 'src', 'prompts')
const promptsDest = join(distBundleDir, 'prompts')
if (existsSync(promptsSrc)) {
  cpSync(promptsSrc, promptsDest, { recursive: true, dereference: true })
  console.log('Copied prompts to dist/bundle/prompts/')
}

// 4. Copy top-level .md/.txt files from src/ that might be used at runtime
const srcDir = join(rootDir, 'src')
const srcRootEntries = readdirSync(srcDir, { withFileTypes: true })
for (const entry of srcRootEntries) {
  const fullPath = join(srcDir, entry.name)
  if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
    cpSync(fullPath, join(distBundleDir, entry.name), { force: true })
    console.log(`Copied ${entry.name} to dist/bundle/`)
  }
}

console.log(`\nAssets copied to dist/bundle/`)
console.log(`Bundle directory structure:`)
listDir(distBundleDir, '')

function listDir(dir: string, prefix: string) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      console.log(`${prefix}${entry.name}/`)
      listDir(fullPath, prefix + '  ')
    } else {
      const size = getFileSize(fullPath)
      console.log(`${prefix}${entry.name} (${size})`)
    }
  }
}

function getFileSize(path: string): string {
  const { statSync } = require('node:fs')
  const bytes = statSync(path).size
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
