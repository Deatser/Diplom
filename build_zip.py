import zipfile, os

src = 'dist'
out = 'build_yandex.zip'

if os.path.exists(out):
    os.remove(out)

count = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src).replace(os.sep, '/')  # forward slashes
            z.write(full, rel)
            count += 1

print(f'Записано файлов: {count}')
print(f'Размер: {os.path.getsize(out):,} байт')

# Самопроверка: читаем обратно, ищем обратные слэши и ключевые файлы
with zipfile.ZipFile(out) as z:
    names = z.namelist()
    bad = [n for n in names if '\\' in n]
    print('Записей с обратным слэшем (должно 0):', len(bad))
    print('index.html в корне:', 'index.html' in names)
    print('worker в корне:', 'game-tick-worker.js' in names)
    print('бандл JS:', any(n.startswith('assets/index-') and n.endswith('.js') for n in names))
    print('бандл CSS:', any(n.startswith('assets/index-') and n.endswith('.css') for n in names))
    print('level1.json:', 'levels/level1/level1.json' in names)
    bad_zip = z.testzip()
    print('testzip (None = ок):', bad_zip)
