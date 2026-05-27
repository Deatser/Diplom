export function initParticles() {
  const container = document.getElementById('particles')
  for (let i = 0; i < 35; i++) {
    const p = document.createElement('div')
    p.className = 'particle'
    const size = Math.random() * 2.5 + 0.5
    p.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${Math.random() * 100}%;
      animation-duration: ${Math.random() * 18 + 10}s;
      animation-delay: ${Math.random() * -20}s;
      opacity: ${Math.random() * 0.5 + 0.1};
    `
    container.appendChild(p)
  }
}
