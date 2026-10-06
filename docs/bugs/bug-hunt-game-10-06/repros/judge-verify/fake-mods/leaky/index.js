export function register(ctx) {
  ctx.ui.pane({ id: 'p', title: 'Leaked', component: () => 'ghost' })
  ctx.ui.status('LEAKED STATUS')
  throw new Error('boom')
}
