// Бесшовный переход между экранами через полноэкранное затемнение.
// fadeOut: экран плавно чернеет → колбэк (смена экрана за чёрным).
// fadeIn: плавно проявляется из чёрного.
const Transition = {
	_el: null,

	_ensure() {
		if (this._el) return this._el
		const el = document.createElement('div')
		el.id = 'screen-fade'
		el.style.cssText =
			'position:fixed;inset:0;background:#000;opacity:0;z-index:300;pointer-events:none;'
		document.body.appendChild(el)
		this._el = el
		return el
	},

	// Затемнить за ms, затем вызвать cb (уже на чёрном экране).
	fadeOut(cb, ms = 1000) {
		const el = this._ensure()
		el.style.transition = `opacity ${ms}ms ease`
		el.style.pointerEvents = 'auto'
		void el.offsetWidth // зафиксировать стартовую прозрачность → transition сработает
		el.style.opacity = '1'
		setTimeout(() => cb?.(), ms)
	},

	// Мгновенно сделать экран чёрным (держать черноту, напр. через рестарт сцены).
	black() {
		const el = this._ensure()
		el.style.transition = 'none'
		el.style.pointerEvents = 'auto'
		void el.offsetWidth
		el.style.opacity = '1'
	},

	// Проявить из чёрного за ms. Если экран не был затемнён (opacity 0) — это no-op.
	fadeIn(ms = 1000) {
		const el = this._ensure()
		el.style.transition = `opacity ${ms}ms ease`
		void el.offsetWidth
		el.style.opacity = '0'
		setTimeout(() => {
			el.style.pointerEvents = 'none'
		}, ms)
	},
}

export default Transition
