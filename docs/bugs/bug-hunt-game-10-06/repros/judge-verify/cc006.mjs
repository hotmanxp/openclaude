import fs from 'node:fs'
function looksLikeMemorySecretValue(s){return false}
function looksLikeSecret(segment){
  const s=segment.trim()
  if(s.length===0)return true
  if(looksLikeMemorySecretValue(s))return true
  if(s.length>=16&&/^[a-f0-9]+$/.test(s))return true
  if(s.length>=12&&/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(s))return true
  return false
}
const samples=['documentation','configuration','authentication','understand','node_modules','src','Users','notes','opencc','buildconfig','internationalization']
console.log('--- segments judged SECRET by :78 filter ---')
for(const s of samples) if(looksLikeSecret(s)) console.log('  ', s)

const path='/Users/ethan/code/opencc/documentation/notes'
const segs=path.split('/').filter(Boolean)
const safeSegs=segs.filter(s=>!looksLikeSecret(s))
console.log('\norig :',path)
console.log('segs :',JSON.stringify(segs))
console.log('dropped:',JSON.stringify(segs.filter(s=>looksLikeSecret(s))))
const safePath='/'+safeSegs.join('/')
console.log('safePath:',safePath)
console.log('exists on disk? ',fs.existsSync(safePath))
console.log('persisted fact -> `Project path: ${safePath}` (len',safePath.length+')')
