import { dismissToast, toast } from '../lib/store'

export function Toast() {
  const state = toast.value
  if (!state) return null
  return (
    <div class="toast-wrap">
      <div class="toast" role="status" aria-live="polite">
        <span class="toast-text">{state.text}</span>
        {state.action && (
          <button
            class="toast-action"
            onClick={() => { state.action?.run(); dismissToast() }}
          >
            {state.action.label}
          </button>
        )}
      </div>
    </div>
  )
}
