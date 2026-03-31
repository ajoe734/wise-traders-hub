import { createElement as h } from 'react'
import { C, alpha } from '../../theme.js'
import { Button } from './Base.jsx'

function DialogShell({
  open,
  title,
  subtitle,
  onClose,
  ariaLabel,
  width = 'min(460px, 100%)',
  children,
  footer,
}) {
  if (!open) return null

  return h(
    'div',
    {
      style: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.36)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 90,
      },
      onClick: (event) => {
        if (event.target === event.currentTarget) onClose?.()
      },
    },
    h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': ariaLabel || title,
        style: {
          width,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          boxShadow: `${C.insetLine}, ${C.shadow}`,
          padding: '18px 18px 16px',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
            marginBottom: 14,
          },
        },
        h(
          'div',
          null,
          title &&
            h(
              'div',
              { style: { fontSize: 10, color: C.teal, fontWeight: 700, letterSpacing: '0.08em' } },
              title
            ),
          subtitle &&
            h(
              'div',
              {
                style: {
                  fontSize: 12,
                  color: C.textSec,
                  marginTop: 5,
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                },
              },
              subtitle
            )
        ),
        onClose &&
          h(
            Button,
            {
              onClick: onClose,
              style: { padding: '4px 10px' },
            },
            '關閉'
          )
      ),
      children,
      footer &&
        h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 16,
              flexWrap: 'wrap',
            },
          },
          footer
        )
    )
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '確認',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  busy = false,
  tone = 'danger',
}) {
  const accent = tone === 'warning' ? C.amber : tone === 'primary' ? C.teal : C.up
  const fill = tone === 'warning' ? C.fillAmber : tone === 'primary' ? C.fillTeal : C.fillTomato

  return h(DialogShell, {
    open,
    title,
    subtitle: message,
    onClose: onCancel,
    footer: [
      h(
        Button,
        {
          onClick: onCancel,
          style: { padding: '6px 12px' },
        },
        cancelLabel
      ),
      h(
        Button,
        {
          onClick: onConfirm,
          disabled: busy,
          style: {
            padding: '6px 14px',
            border: 'none',
            background: busy ? C.subtle : alpha(fill, '40'),
            color: busy ? C.textMute : C.onFill,
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            borderRadius: 999,
            boxShadow: `inset 0 0 0 1px ${alpha(accent, '25')}`,
          },
        },
        busy ? '處理中...' : confirmLabel
      ),
    ],
  })
}

export function TextFieldDialog({
  open,
  title,
  subtitle,
  label,
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel = '儲存',
  cancelLabel = '取消',
  placeholder = '',
  busy = false,
  submitDisabled = false,
  inputMode,
  type = 'text',
  error = '',
}) {
  return h(
    DialogShell,
    {
      open,
      title,
      subtitle,
      onClose: onCancel,
    },
    h(
      'label',
      {
        style: {
          display: 'grid',
          gap: 5,
          fontSize: 10,
          color: C.textMute,
        },
      },
      label,
      h('input', {
        value,
        onChange,
        placeholder,
        autoFocus: true,
        inputMode,
        type,
        style: {
          width: '100%',
          background: C.subtle,
          border: `1px solid ${error ? alpha(C.up, '40') : C.border}`,
          borderRadius: 8,
          padding: '10px 12px',
          color: C.text,
          fontSize: 12,
          outline: 'none',
          fontFamily: 'inherit',
        },
      })
    ),
    error &&
      h(
        'div',
        {
          style: {
            marginTop: 8,
            fontSize: 10,
            color: C.up,
          },
        },
        error
      ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 16,
          flexWrap: 'wrap',
        },
      },
      h(
        Button,
        {
          onClick: onCancel,
          style: { padding: '6px 12px' },
        },
        cancelLabel
      ),
      h(
        Button,
        {
          onClick: onSubmit,
          disabled: busy || submitDisabled,
          style: {
            padding: '6px 14px',
            border: 'none',
            background: busy || submitDisabled ? C.subtle : alpha(C.fillTeal, '40'),
            color: busy || submitDisabled ? C.textMute : C.onFill,
            cursor: busy || submitDisabled ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            borderRadius: 999,
          },
        },
        busy ? '處理中...' : submitLabel
      )
    )
  )
}
