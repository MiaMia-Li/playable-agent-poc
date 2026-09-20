/** Decorative SVG image layer. The caller owns a positioned container and transparent foreground. */
export function mountSvgBackground({ container, source, portraitSource, landscapeSource }) {
  const sources = [source, portraitSource, landscapeSource].filter((value) => value !== undefined)
  if (!container || !sources.length || (!source && (!portraitSource || !landscapeSource))) {
    throw new Error('Provide a container and a source or both orientation sources')
  }
  // Keep uploaded SVG in an image context: no markup insertion or active embedded document.
  if (sources.some((value) => typeof value !== 'string' || !/^data:image\/svg\+xml[;,]/i.test(value))) {
    throw new Error('SVG backgrounds must be embedded image/svg+xml data URLs')
  }
  const image = container.ownerDocument.createElement('img')
  image.alt = ''
  image.setAttribute('aria-hidden', 'true')
  image.dataset.playableSvgBackground = ''
  image.draggable = false
  Object.assign(image.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    objectFit: 'cover', objectPosition: 'center', pointerEvents: 'none',
    userSelect: 'none', zIndex: '0',
  })
  let currentSource
  const update = () => {
    const { width, height } = container.getBoundingClientRect()
    const next = (width > height ? landscapeSource : portraitSource) ?? source
    if (next !== currentSource) {
      image.src = next
      currentSource = next
    }
  }
  update()
  container.prepend(image)
  const view = container.ownerDocument.defaultView
  const observer = view.ResizeObserver ? new view.ResizeObserver(update) : null
  observer?.observe(container)
  view.addEventListener('resize', update)
  return {
    element: image,
    destroy() {
      observer?.disconnect()
      view.removeEventListener('resize', update)
      image.remove()
    },
  }
}
