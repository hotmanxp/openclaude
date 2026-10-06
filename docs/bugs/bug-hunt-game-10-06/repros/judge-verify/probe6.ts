import { realpath, lstat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
const link = '/tmp/judge-verify/fence/inside/link.txt'
console.log('lstat link:', (await lstat(link)).isSymbolicLink())
console.log('realpath link:', await realpath(link))
console.log('realpath cwd:', await realpath(process.cwd()))
console.log('realpath inside:', await realpath('/tmp/judge-verify/fence/inside'))
console.log('relative(insideReal, linkReal) =', relative(await realpath('/tmp/judge-verify/fence/inside'), await realpath(link)))
