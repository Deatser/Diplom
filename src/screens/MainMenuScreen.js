import { showScreen } from '../main.js'
import { i18n } from '../utils/i18n.js'

export class MainMenuScreen {
  constructor() {
    this.el = document.getElementById('screen-main-menu')
    this.items = [...this.el.querySelectorAll('.menu-item')]
    this.activeIdx = -1  // -1 = no keyboard selection yet
    this._onKey = this._onKeyDown.bind(this)
  }

  show() {
    this.el.classList.remove('hidden')
    this.activeIdx = -1
    this.items.forEach(i => i.classList.remove('active'))
    window.addEventListener('keydown', this._onKey)

    this.el.querySelectorAll('.menu-item').forEach(btn => {
      btn.onclick = () => this._trigger(btn.dataset.action)
    })
  }

  hide() {
    this.el.classList.add('hidden')
    window.removeEventListener('keydown', this._onKey)
  }

  _setActive(idx) {
    this.items.forEach(i => i.classList.remove('active'))
    this.activeIdx = ((idx % this.items.length) + this.items.length) % this.items.length
    this.items[this.activeIdx].classList.add('active')
  }

  _onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this._setActive(this.activeIdx < 0 ? 0 : this.activeIdx + 1)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this._setActive(this.activeIdx < 0 ? this.items.length - 1 : this.activeIdx - 1)
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (this.activeIdx >= 0) this._trigger(this.items[this.activeIdx].dataset.action)
    }
  }

  _trigger(action) {
    if (action === 'start')    showScreen('lobby')
    if (action === 'settings') showScreen('settings', { from: 'main-menu' })
    if (action === 'quit')     this._showQuitConfirm()
  }

  _showQuitConfirm() {
    const modal = document.createElement('div')
    modal.className = 'confirm-modal'
    modal.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-text">${i18n.t('confirm.quit')}</p>
        <div class="confirm-buttons">
          <button class="confirm-yes">${i18n.t('confirm.yes')}</button>
          <button class="confirm-no">${i18n.t('confirm.no')}</button>
        </div>
      </div>`
    document.body.appendChild(modal)
    modal.querySelector('.confirm-yes').onclick = () => {
      modal.remove()
      window.close()
      // Fallback: browsers block window.close() unless opened by script → navigate away
      setTimeout(() => { window.location.replace('about:blank') }, 200)
    }
    modal.querySelector('.confirm-no').onclick  = () => modal.remove()
  }
}
