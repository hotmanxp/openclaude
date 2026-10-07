const re = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
const s = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----'
console.log('t1:', re.test(s), 'lastIndex:', re.lastIndex)
console.log('t2:', re.test(s), 'lastIndex:', re.lastIndex)
console.log('t3:', re.test(s), 'lastIndex:', re.lastIndex)
console.log('node:', process.version, 'bun:', typeof Bun !== 'undefined' ? Bun.version : 'n/a')
