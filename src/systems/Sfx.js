import { SaveSystem } from './SaveSystem.js'

// Одноразовые UI-звуки (HTML5 Audio). Каждый play создаёт новый Audio → звуки
// могут накладываться. Громкость = base × master × sfx из настроек.
const FILES = {
	slide: 'assets/audio/slide.ogg',
	clickOK: 'assets/audio/clickOK.ogg',
	clickBAD: 'assets/audio/clickBAD.ogg',
	levelStart: 'assets/audio/LevelStart.ogg',
}

const Sfx = {
	_base: 0.35, // громкость при master=10, sfx=10 (приглушено, чтобы не било по ушам)

	_vol() {
		const a = SaveSystem.getSettings().audio
		return (a.master / 10) * ((a.sfx ?? 10) / 10)
	},

	play(name) {
		const src = FILES[name]
		if (!src) return
		const a = new Audio(src)
		a.volume = Math.max(0, Math.min(1, this._base * this._vol()))
		a.play().catch(() => {})
	},
}

export default Sfx
