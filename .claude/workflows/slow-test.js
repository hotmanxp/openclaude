__setMeta({ name: 'slow-test', description: 'Slow workflow for panel testing', phases: [{ title: 'Phase 1' }] })
await new Promise(r => setTimeout(r, 60000))
return 'done'
