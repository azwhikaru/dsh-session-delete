window.__ModuleLoader__.load({
  id: '@local/session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'session-delete'
    const SLOT = 'sidebar.workspaces.session.menu.item'
    const ROUTE = '/session-delete/delete'

    const zh = {
      'action.delete': '删除会话',
      'action.confirm': '确认删除',
      'action.inUse': '会话仍在使用中',
      'action.failed': '删除失败',
    }
    const en = {
      'action.delete': 'Delete session',
      'action.confirm': 'Confirm delete',
      'action.inUse': 'Session is still in use',
      'action.failed': 'Delete failed',
    }

    const STYLES = `
.dsh-session-delete-separator {
  height: .5px;
  margin: 3px 8px;
  background: var(--dsw-alias-border-l2);
}
.dsh-session-delete-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-session-delete-row:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  outline: none;
}
@media (hover: hover) {
  .dsh-session-delete-row:hover {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
}
.dsh-session-delete-icon {
  display: inline-flex;
  flex: none;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
}
.dsh-session-delete-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

    function TrashIcon() {
      return h('svg', {
        className: 'dsh-session-delete-icon',
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        strokeWidth: 1,
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('path', { d: 'M1.28149 3.88831H14.7187', stroke: 'currentColor' }),
      h('path', {
        d: 'M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833',
        stroke: 'currentColor',
      }),
      h('path', {
        d: 'M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831',
        stroke: 'currentColor',
      }),
      h('path', { d: 'M6.44946 6.98926V11.1238', stroke: 'currentColor' }),
      h('path', { d: 'M9.55054 6.98926V11.1238', stroke: 'currentColor' }))
    }

    function useNoMenuState() {
      return [false, () => {}]
    }

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'session-delete: row styles')
      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'session-delete: zh copy')
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'session-delete: en copy')
      const t = ctx.locale.bind(NS)

      function DeleteRow(props) {
        const { sessionId } = props
        const [, setMenuOpen] = (props.useMenuOpenState ?? useNoMenuState)()
        const [step, setStep] = React.useState('idle')
        const label = t(step === 'idle' ? 'action.delete' : step === 'busy' ? 'action.confirm' : `action.${step}`)

        const onClick = async (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (step === 'busy') return
          if (step === 'idle') {
            setStep('confirm')
            return
          }
          setStep('busy')
          try {
            const response = await fetch(ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            })
            const payload = await response.json().catch(() => undefined)
            if (payload?.ok === true) {
              setMenuOpen(false)
              ctx.get('uiWorkspace')?.startSession()
              return
            }
            setStep(payload?.code === 'session-delete/in-use' ? 'inUse' : 'failed')
          } catch {
            setStep('failed')
          }
        }

        return h(React.Fragment, null,
          h('div', { className: 'dsh-session-delete-separator', role: 'presentation' }),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsh-session-delete-row',
            onClick,
          }, h(TrashIcon), h('span', { className: 'dsh-session-delete-label', 'aria-live': 'polite' }, label)))
      }

      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: 'delete-session',
        order: 500,
      }, DeleteRow))
    }

    function installStyles() {
      const existing = document.querySelector('style[data-dsh-session-delete]')
      if (existing !== null) return () => {}
      const element = document.createElement('style')
      element.setAttribute('data-dsh-session-delete', '')
      element.textContent = STYLES
      document.head.appendChild(element)
      return () => { element.remove() }
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
