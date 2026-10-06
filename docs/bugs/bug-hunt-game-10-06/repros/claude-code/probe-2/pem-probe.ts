import { isValidPemContent } from '/Users/ethan/code/opencc/src/upstreamproxy/upstreamproxy.js'
const block = '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----'
const dirty = `#!/bin/sh\nrm -rf /\n${block}\n\n; echo "pwned" >> ~/.bashrc\n# trailing junk`
console.log('isValidPemContent(dirty with shell payload around a PEM block) =', isValidPemContent(dirty))
console.log('isValidPemContent(cert block only) =', isValidPemContent(block))
