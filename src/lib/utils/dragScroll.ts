export type DragScrollOptions = {
  axis?: 'x' | 'y' | 'both'
  thresholdPx?: number
  inertia?: boolean
  multiplier?: number
}

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  const selector = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[data-drag-scroll-ignore]'
  ].join(',')

  return Boolean(target.closest(selector))
}

export function dragScroll(node: HTMLElement, options: DragScrollOptions = {}) {
  let axis: 'x' | 'y' | 'both' = options.axis ?? 'both'
  let thresholdPx = options.thresholdPx ?? 3
  let inertia = options.inertia ?? false
  let multiplier = options.multiplier ?? 1.8

  let startX = 0
  let startY = 0
  let pointerDownT = 0
  let lastX = 0
  let lastY = 0
  let startScrollLeft = 0
  let startScrollTop = 0

  let pointerDown = false
  let activePointerId: number | null = null

  let dragging = false
  let decidedAxis: 'x' | 'y' | 'both' | null = null
  let suppressClick = false

  let lastMoveT = 0
  let lastMoveX = 0
  let lastMoveY = 0
  let velocityX = 0
  let velocityY = 0

  let samples: Array<{ t: number; x: number; y: number }> = []

  let rafId: number | null = null

  const prevTouchAction = node.style.touchAction
  const prevWebkitUserDrag = (node.style as any).webkitUserDrag as string | undefined
  const prevScrollBehavior = node.style.scrollBehavior

  function setScrollBehaviorAuto() {
    node.style.scrollBehavior = 'auto'
  }

  function restoreScrollBehavior() {
    node.style.scrollBehavior = prevScrollBehavior
  }

  function stopInertia() {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    restoreScrollBehavior()
  }

  function onClickCapture(e: MouseEvent) {
    if (!suppressClick) return
    suppressClick = false
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    if (isInteractiveElement(e.target)) return

    stopInertia()

    // Disable smooth scrolling while dragging.
    setScrollBehaviorAuto()

    pointerDown = true
    activePointerId = e.pointerId

    dragging = false
    decidedAxis = null
    suppressClick = false

    startX = e.clientX
    startY = e.clientY
    pointerDownT = performance.now()
    lastX = startX
    lastY = startY
    startScrollLeft = node.scrollLeft
    startScrollTop = node.scrollTop

    lastMoveT = performance.now()
    lastMoveX = startX
    lastMoveY = startY
    velocityX = 0
    velocityY = 0

    samples = [{ t: lastMoveT, x: startX, y: startY }]
  }

  function pickAxis(dx: number, dy: number): 'x' | 'y' {
    return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
  }

  function canScrollX(): boolean {
    return node.scrollWidth > node.clientWidth + 1
  }

  function canScrollY(): boolean {
    return node.scrollHeight > node.clientHeight + 1
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointerDown) return
    if (activePointerId !== e.pointerId) return
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return

    const dx = e.clientX - startX
    const dy = e.clientY - startY

    lastX = e.clientX
    lastY = e.clientY

    if (!dragging) {
      if (axis === 'y') {
        if (Math.abs(dy) < thresholdPx) return
        if (!canScrollY()) return
        decidedAxis = 'y'
      } else if (axis === 'x') {
        if (Math.abs(dx) < thresholdPx) return
        if (!canScrollX()) return
        decidedAxis = 'x'
      } else {
        if (Math.abs(dx) < thresholdPx && Math.abs(dy) < thresholdPx) return

        const primary = pickAxis(dx, dy)

        if (primary === 'x' && !canScrollX()) {
          if (!canScrollY()) return
          decidedAxis = 'y'
        } else if (primary === 'y' && !canScrollY()) {
          if (!canScrollX()) return
          decidedAxis = 'x'
        } else {
          decidedAxis = primary
        }
      }

      dragging = true
      suppressClick = true
      node.style.userSelect = 'none'

      // Capture only after drag starts; avoids breaking clicks.
      node.setPointerCapture(e.pointerId)
    }

    if (!dragging) {
      restoreScrollBehavior()
      return
    }

    if (decidedAxis === 'x') {
      node.scrollLeft = startScrollLeft - dx * multiplier
    } else if (decidedAxis === 'y') {
      node.scrollTop = startScrollTop - dy * multiplier
    } else {
      node.scrollLeft = startScrollLeft - dx * multiplier
      node.scrollTop = startScrollTop - dy * multiplier
    }

    const now = performance.now()
    const dt = Math.max(1, now - lastMoveT)
    velocityX = (e.clientX - lastMoveX) / dt
    velocityY = (e.clientY - lastMoveY) / dt
    lastMoveT = now
    lastMoveX = e.clientX
    lastMoveY = e.clientY

    samples.push({ t: now, x: e.clientX, y: e.clientY })
    const cutoff = now - 250
    while (samples.length > 2 && samples[0].t < cutoff) samples.shift()

    e.preventDefault()
  }

  function onPointerUp() {
    if (!pointerDown) return

    pointerDown = false
    activePointerId = null

    node.style.userSelect = ''

    if (!dragging) {
      restoreScrollBehavior()
      return
    }

    dragging = false

    if (!inertia) {
      restoreScrollBehavior()
      return
    }

    const now = performance.now()
    const last = samples[samples.length - 1]
    const span = Math.max(1, last.t - (samples[0]?.t ?? now))

    const totalDistX = lastX - startX
    const totalDistY = lastY - startY

    // Use last meaningful movement for release velocity.
    let ref = samples[0] ?? last
    for (let i = samples.length - 2; i >= 0; i--) {
      const s = samples[i]
      const moved = Math.abs(last.x - s.x) + Math.abs(last.y - s.y)
      const dt = last.t - s.t
      if (dt >= 16 && moved >= 3) {
        ref = s
        break
      }
    }

    const velSpan = Math.max(1, last.t - ref.t)

    let vX = -((last.x - ref.x) / velSpan)
    let vY = -((last.y - ref.y) / velSpan)

    if (!Number.isFinite(vX)) vX = -velocityX
    if (!Number.isFinite(vY)) vY = -velocityY

    if (decidedAxis === 'x') vY = 0
    if (decidedAxis === 'y') vX = 0

    // Derive fling from overall gesture.
    const gestureDuration = Math.max(1, now - pointerDownT)
    const avgVX = -(totalDistX / gestureDuration)
    const avgVY = -(totalDistY / gestureDuration)

    const minGestureDistancePx = 4
    const minFlingVelocityPxPerMs = 0.06

    if (decidedAxis === 'y' && Math.abs(totalDistY) >= minGestureDistancePx) {
      const candidate = Math.abs(vY) >= Math.abs(avgVY) ? vY : avgVY
      vY = Math.abs(candidate) < minFlingVelocityPxPerMs
        ? Math.sign(-totalDistY) * minFlingVelocityPxPerMs
        : candidate
    }

    if (decidedAxis === 'x' && Math.abs(totalDistX) >= minGestureDistancePx) {
      const candidate = Math.abs(vX) >= Math.abs(avgVX) ? vX : avgVX
      vX = Math.abs(candidate) < minFlingVelocityPxPerMs
        ? Math.sign(-totalDistX) * minFlingVelocityPxPerMs
        : candidate
    }

    const releaseBoost = 1.4
    vX *= releaseBoost * multiplier
    vY *= releaseBoost * multiplier

    const vMax = 1.6 // px/ms
    if (vX > vMax) vX = vMax
    if (vX < -vMax) vX = -vMax
    if (vY > vMax) vY = vMax
    if (vY < -vMax) vY = -vMax

    const vMin = 0.01
    if (Math.abs(vX) < vMin && Math.abs(vY) < vMin) return

    const decayPer16ms = 0.94
    let lastT = now

    const step = (t: number) => {
      const dt = Math.min(64, Math.max(1, t - lastT))
      lastT = t

      const decay = Math.pow(decayPer16ms, dt / 16)
      vX *= decay
      vY *= decay

      if (Math.abs(vX) < vMin && Math.abs(vY) < vMin) {
        rafId = null
        restoreScrollBehavior()
        return
      }

      if (vX !== 0) node.scrollLeft += vX * dt
      if (vY !== 0) node.scrollTop += vY * dt

      rafId = requestAnimationFrame(step)
    }

    rafId = requestAnimationFrame(step)
  }

  function onPointerCancel() {
    if (!pointerDown) return
    pointerDown = false
    activePointerId = null
    node.style.userSelect = ''
    dragging = false
    restoreScrollBehavior()
  }

  node.addEventListener('pointerdown', onPointerDown)
  node.addEventListener('pointermove', onPointerMove, { passive: false })
  node.addEventListener('pointerup', onPointerUp)
  node.addEventListener('pointercancel', onPointerCancel)
  node.addEventListener('click', onClickCapture, { capture: true })

  const preventNativeDrag = (e: Event) => {
    if (!pointerDown) return
    e.preventDefault()
  }

  node.addEventListener('dragstart', preventNativeDrag, { capture: true })
  node.addEventListener('selectstart', preventNativeDrag, { capture: true })

  node.style.touchAction = 'none'
  ;(node.style as any).webkitUserDrag = 'none'

  return {
    update(next: DragScrollOptions) {
      options = next
      axis = next.axis ?? 'both'
      thresholdPx = next.thresholdPx ?? 3
      inertia = next.inertia ?? false
      multiplier = next.multiplier ?? 1.8
    },
    destroy() {
      stopInertia()
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('pointermove', onPointerMove)
      node.removeEventListener('pointerup', onPointerUp)
      node.removeEventListener('pointercancel', onPointerCancel)
      node.removeEventListener('click', onClickCapture, true)
      node.removeEventListener('dragstart', preventNativeDrag, true)
      node.removeEventListener('selectstart', preventNativeDrag, true)
      node.style.touchAction = prevTouchAction
      ;(node.style as any).webkitUserDrag = prevWebkitUserDrag
      restoreScrollBehavior()
      node.style.userSelect = ''
    }
  }
}
