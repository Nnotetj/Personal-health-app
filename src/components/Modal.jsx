import { useEffect, useId, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ title, onClose, children, wide }) {
  const titleId = useId()
  const box = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // ย้ายโฟกัสเข้ากล่อง, วน Tab อยู่ในกล่อง, Esc ปิด, ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิด
  useEffect(() => {
    const opener = document.activeElement
    const el = box.current
    if (!el.contains(document.activeElement)) {
      const first = el.querySelector(`.modal-body ${FOCUSABLE}`) || el
      first.focus()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn-quiet" onClick={onClose}>ปิด</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
