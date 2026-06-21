import { defineConfig } from 'vite'

export default defineConfig({
  // Относительные пути к ассетам в собранном index.html. Яндекс Игры раздают
  // игру из вложенного пути (не из корня домена), поэтому абсолютные '/assets/…'
  // там дают 404 (пустая нестилизованная страница). './' делает их относительными.
  base: './',
  server: { port: 8080 },
  build: { outDir: 'dist' }
})
