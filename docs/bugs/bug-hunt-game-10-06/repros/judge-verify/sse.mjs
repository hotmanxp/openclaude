// Faithful re-implementation of anthropicSsePassthrough framing (lines 60-131)
function parseSseFrame(frame){const d=[];for(const raw of frame.split('\n')){const l=raw.trimEnd();if(!l||l.startsWith(':'))continue;if(l.startsWith('data:'))d.push(l.slice(5).trimStart());}if(!d.length)return null;try{const p=JSON.parse(d.join('\n'));return p&&typeof p==='object'&&'type' in p?p:null}catch{return null}}
function run(body){let buffer='';const evs=[];const chunks=body.match(/[\s\S]{1,7}/g)||[];for(const c of chunks){buffer+=c;let b=buffer.indexOf('\n\n');while(b!==-1){const f=buffer.slice(0,b);buffer=buffer.slice(b+2);const e=parseSseFrame(f);if(e)evs.push(e.type);b=buffer.indexOf('\n\n')}}
const tail=buffer.trim();if(tail){const e=parseSseFrame(tail);if(e)evs.push(e.type)}return evs}
const evs=['message_start','content_block_delta','message_stop'].map((t,i)=>`event: ${t}\ndata: ${JSON.stringify({type:t,index:i})}`);
console.log('LF  framing:', run(evs.join('\n\n')+'\n\n').join(','));
console.log('CRLF framing:', run(evs.join('\r\n\r\n')+'\r\n\r\n').join(',') || '(none)');
