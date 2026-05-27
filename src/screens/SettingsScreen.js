import { showScreen } from '../main.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { i18n } from '../utils/i18n.js'

const KEYBIND_LABELS = {
  move_left: 'Влево', move_right: 'Вправо', jump: 'Прыжок / Взаимодействие',
  dash: 'Дэш', down: 'Вниз', special: 'Особое (ПКМ)',
  menu: 'Меню / Назад', fullscreen: 'Полный экран'
}

export class SettingsScreen {
  constructor() {
    this.el      = document.getElementById('screen-settings')
    this.nav     = document.getElementById('settings-nav')
    this.panel   = document.getElementById('settings-panel')
    this.backBtn = document.getElementById('settings-back-btn')
    this.from    = 'main-menu'
    this._state  = 'categories'  // 'categories' | 'section'
    this._onKey  = this._onKeyDown.bind(this)
    this._setupNav()
    this._setupBack()
  }

  show({ from = 'main-menu', fromGame = false } = {}) {
    this.from = from
    // When opened over the game, add opaque backdrop so game doesn't show through
    this.el.classList.toggle('in-game', fromGame)
    this.el.classList.remove('hidden')
    window.addEventListener('keydown', this._onKey)
    this._goToCategories()
  }

  hide() {
    this.el.classList.remove('in-game')
    this.el.classList.add('hidden')
    window.removeEventListener('keydown', this._onKey)
  }

  // ── State 1: category list ──
  _goToCategories() {
    this._state = 'categories'
    this.nav.classList.remove('hidden')
    this.panel.classList.add('hidden')
    this.panel.innerHTML = ''
  }

  // ── State 2: section panel ──
  _goToSection(section) {
    this._state = 'section'
    this.nav.classList.add('hidden')
    this.panel.classList.remove('hidden')
    this._renderSection(section)
  }

  _setupNav() {
    this.el.querySelectorAll('[data-section]').forEach(btn => {
      btn.onclick = () => this._goToSection(btn.dataset.section)
    })
  }

  _setupBack() {
    this.backBtn.onclick = () => {
      if (this._state === 'section') {
        this._goToCategories()
      } else {
        // State 1: go back to wherever we came from
        showScreen(this.from)
      }
    }
  }

  _onKeyDown(e) {
    const menuKey = SaveSystem.getSettings().keybindings.menu || 'Backquote'
    if (e.code === menuKey || e.key === 'Escape') {
      if (this._state === 'section') {
        this._goToCategories()
      } else {
        showScreen(this.from)
      }
    }
  }

  _renderSection(section) {
    const s = SaveSystem.getSettings()
    if (section === 'language')  this.panel.innerHTML = this._langHTML(s)
    if (section === 'audio')     this.panel.innerHTML = this._audioHTML(s)
    if (section === 'video')     this.panel.innerHTML = this._videoHTML(s)
    if (section === 'keyboard')  this.panel.innerHTML = this._keyboardHTML(s)
    this._attachEvents(section, s)
  }

  _langHTML(s) {
    return `
      <div class="settings-row">
        <label>Язык / Language</label>
        <div style="display:flex;gap:8px">
          <button class="lang-btn ${s.lang==='ru'?'active':''}" data-lang="ru">Русский</button>
          <button class="lang-btn ${s.lang==='en'?'active':''}" data-lang="en">English</button>
        </div>
      </div>`
  }

  _audioHTML(s) {
    return ['master','music','sfx'].map(k => `
      <div class="settings-row">
        <label>${{master:'Общий',music:'Музыка',sfx:'Звуки'}[k]}</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="range" min="0" max="10" value="${s.audio[k]}" data-audio="${k}" />
          <span class="range-val" id="val-${k}">${s.audio[k]}</span>
        </div>
      </div>`).join('') +
      `<button class="default-btn" data-default="audio">По умолчанию</button>`
  }

  _videoHTML(s) {
    const native = `${window.screen.width}x${window.screen.height}`
    const opts = [...new Set(['1280x720','1920x1080','2560x1440', native])].sort()
    return `
      <div class="settings-row">
        <label>Разрешение монитора</label>
        <select class="settings-select" data-video="resolution">
          ${opts.map(r => `<option ${s.video.resolution===r?'selected':''}>${r}${r===native?' (ваш монитор)':''}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row" style="opacity:0.5;font-size:0.8rem">
        <label style="font-size:0.8rem">Игра рендерится в высоком качестве автоматически</label>
      </div>
      <div class="settings-row">
        <label>Полный экран</label>
        <button class="toggle-btn ${s.video.fullscreen?'on':''}" data-video="fullscreen">
          ${s.video.fullscreen ? 'Вкл' : 'Выкл'}
        </button>
      </div>
      <div class="settings-row">
        <label>Яркость</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="range" min="1" max="10" value="${s.video.brightness}" data-audio="brightness" data-video="brightness"/>
          <span class="range-val" id="val-brightness">${s.video.brightness}</span>
        </div>
      </div>
      <button class="default-btn" data-default="video">По умолчанию</button>`
  }

  _keyboardHTML(s) {
    return Object.entries(KEYBIND_LABELS).map(([k, label]) => `
      <div class="keybind-row">
        <span>${label}</span>
        <button class="keybind-key" data-bind="${k}">${this._keyName(s.keybindings[k])}</button>
      </div>`).join('') +
      `<button class="default-btn" data-default="keyboard" style="margin-top:16px">По умолчанию</button>`
  }

  _keyName(code) {
    if (!code) return '—'
    if (code === 'Mouse2') return 'ПКМ'
    if (code === 'Backquote') return '` / Ё'
    return code.replace('Key','').replace('Arrow','↑↓').replace('ShiftLeft','Shift L').replace('ShiftRight','Shift R').replace('Space','Пробел')
  }

  _attachEvents(section, s) {
    // Language
    this.panel.querySelectorAll('[data-lang]').forEach(btn => {
      btn.onclick = () => {
        s.lang = btn.dataset.lang; SaveSystem.setSettings(s); i18n.setLang(s.lang)
        this._renderSection('language')
      }
    })
    // Audio sliders
    this.panel.querySelectorAll('[data-audio]').forEach(input => {
      input.oninput = () => {
        const k = input.dataset.audio
        const v = +input.value
        if (k === 'brightness') { s.video.brightness = v } else { s.audio[k] = v }
        SaveSystem.setSettings(s)
        const el = document.getElementById(`val-${k}`)
        if (el) el.textContent = v
      }
    })
    // Video select
    this.panel.querySelectorAll('[data-video]').forEach(el => {
      if (el.tagName === 'SELECT') {
        el.onchange = () => { s.video.resolution = el.value; SaveSystem.setSettings(s) }
      }
      if (el.classList.contains('toggle-btn')) {
        el.onclick = () => {
          s.video.fullscreen = !s.video.fullscreen
          SaveSystem.setSettings(s)
          if (s.video.fullscreen) document.documentElement.requestFullscreen?.()
          else document.exitFullscreen?.()
          this._renderSection('video')
        }
      }
    })
    // Keybindings
    this.panel.querySelectorAll('[data-bind]').forEach(btn => {
      btn.onclick = () => {
        btn.classList.add('listening')
        btn.textContent = '...'
        const handler = (e) => {
          e.preventDefault()
          s.keybindings[btn.dataset.bind] = e.code
          SaveSystem.setSettings(s)
          btn.classList.remove('listening')
          btn.textContent = this._keyName(e.code)
          window.removeEventListener('keydown', handler)
        }
        window.addEventListener('keydown', handler)
      }
    })
    // Default buttons
    this.panel.querySelectorAll('[data-default]').forEach(btn => {
      btn.onclick = () => { SaveSystem.resetSettings(); this._renderSection(section) }
    })
  }
}
