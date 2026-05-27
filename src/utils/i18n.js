const T = {
  ru: {
    'menu.start':'Начать игру','menu.settings':'Настройки','menu.quit':'Выход',
    'settings.lang':'Язык','settings.audio':'Звук','settings.video':'Видео',
    'settings.keyboard':'Клавиатура','settings.back':'Назад','settings.default':'По умолчанию',
    'settings.master':'Общий','settings.music':'Музыка','settings.sfx':'Звуки',
    'settings.resolution':'Разрешение','settings.fullscreen':'Полный экран','settings.brightness':'Яркость',
    'lobby.servers':'Доступные серверы','lobby.search':'Поиск по названию...','lobby.join':'Войти',
    'lobby.profile':'Выберите профиль','lobby.new':'Новая игра','lobby.clear':'Clear Save',
    'lobby.level':'Уровень','lobby.no_servers':'Серверов нет',
    'level_select.start':'Начать','level_select.waiting':'Ожидание второго игрока...',
    'ability.dash':'Дэш','ability.doubleJump':'Двойной прыжок','ability.wallCling':'Цепляние за стены',
    'ability.groundSlam':'Удар о землю','ability.airDive':'Воздушный рывок вниз',
    'ability.grapple':'Крюк-кошка','ability.glide':'Парение',
    'ability.conjurePlatform':'Призыв платформы','ability.swap':'Обмен позициями',
    'ability.chargedDash':'Заряженный дэш',
    'key.move_left':'Влево','key.move_right':'Вправо','key.jump':'Прыжок',
    'key.dash':'Дэш','key.down':'Вниз','key.special':'Особое (ПКМ)'
  },
  en: {
    'menu.start':'Start Game','menu.settings':'Settings','menu.quit':'Quit',
    'settings.lang':'Language','settings.audio':'Audio','settings.video':'Video',
    'settings.keyboard':'Keyboard','settings.back':'Back','settings.default':'Reset to Default',
    'settings.master':'Master','settings.music':'Music','settings.sfx':'Sound Effects',
    'settings.resolution':'Resolution','settings.fullscreen':'Fullscreen','settings.brightness':'Brightness',
    'lobby.servers':'Available Servers','lobby.search':'Search by name...','lobby.join':'Join',
    'lobby.profile':'Select Profile','lobby.new':'New Game','lobby.clear':'Clear Save',
    'lobby.level':'Level','lobby.no_servers':'No servers',
    'level_select.start':'Start','level_select.waiting':'Waiting for second player...',
    'ability.dash':'Dash','ability.doubleJump':'Double Jump','ability.wallCling':'Wall Cling',
    'ability.groundSlam':'Ground Slam','ability.airDive':'Air Dive',
    'ability.grapple':'Grapple Hook','ability.glide':'Glide',
    'ability.conjurePlatform':'Conjure Platform','ability.swap':'Position Swap',
    'ability.chargedDash':'Charged Dash',
    'key.move_left':'Move Left','key.move_right':'Move Right','key.jump':'Jump',
    'key.dash':'Dash','key.down':'Down','key.special':'Special (RMB)'
  }
}

class I18n {
  constructor() { this.lang = localStorage.getItem('l2s_lang') || 'ru' }
  t(key) { return T[this.lang]?.[key] ?? T.en[key] ?? key }
  setLang(lang) { this.lang = lang; localStorage.setItem('l2s_lang', lang) }
}

export const i18n = new I18n()
