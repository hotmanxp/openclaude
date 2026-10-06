// tc-003 repro: isValidPemContent is stateful (module-level /g regex + .test())
// Expected: same valid input evaluated twice returns true both times.
// Actual:   true, then false — second call starts scanning at stale lastIndex.
import { isValidPemContent } from '/Users/ethan/code/opencc/src/upstreamproxy/upstreamproxy.ts'

const pem = `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIRAK7sPaikHQIybpXCAgIEwgIwCgYIKoZIzj0EAwIwGDEW
MBQGA1UEAxMNb3BlbmNjIHRlc3RzMB4XDTI2MDEwMTAwMDAwMFoXDTM2MDEwMTAw
MDAwMFowGDEWMBQGA1UEAxMNb3BlbmNjIHRlc3RzMFkwEwYHKoZIzj0CAQYIKoZI
-----END CERTIFICATE-----`

const r1 = isValidPemContent(pem)
const r2 = isValidPemContent(pem)
const r3 = isValidPemContent(pem)
console.log('call1:', r1)
console.log('call2:', r2)
console.log('call3:', r3)
if (r1 === true && (r2 === false || r3 === false)) {
  console.log('REPRODUCED: stateful validator rejects valid PEM on repeat calls')
} else {
  console.log('NOT REPRODUCED')
}
