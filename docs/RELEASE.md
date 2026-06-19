# Auris — релиз и деплой (runbook)

Деплой Auris = опубликованный GitHub-релиз по git-тегу `vX.Y.Z` + сгенерированный
`latest.json` для авто-обновления. Пользователи получают обновление автоматически
через `tauri-plugin-updater`.

См. также [`../CLAUDE.md`](../CLAUDE.md) (общий контекст).

---

## 0. Предпосылки

- Локального Rust-тулчейна на машине разработки НЕТ → весь Rust проверяется через
  CI. Фронт (`tsc`/`vitest`/`vite build`) проверяется локально.
- Прямой `git push origin main` блокируется авто-режимом → изменения вливаются
  только через PR (`gh pr merge`). Push тега (`git push origin vX.Y.Z`) разрешён.
- Секреты GitHub Actions для подписи апдейтов уже настроены:
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Публичный ключ апдейтера зашит в `tauri.conf.json → plugins.updater.pubkey`.

---

## 1. Пошаговый релиз

```bash
# 1) Ветка от свежего main
git checkout main && git fetch origin main -q && git reset --hard origin/main
git checkout -b <type>/<short-name>          # feat/… fix/… chore/…

# 2) Изменения + БАМП ВЕРСИИ (синхронно в двух файлах)
#    package.json: "version": "X.Y.Z"
#    src-tauri/tauri.conf.json: "version": "X.Y.Z"

# 3) Локальная проверка фронта (Rust — через CI)
npx tsc --noEmit && npm test && npm run build

# 4) Push ветки + PR
git add -A && git commit -m "..."            # см. формат коммита ниже
git push -u origin <branch>
gh pr create --base main --head <branch> --title "..." --body "..."

# 5) ДОЖДАТЬСЯ ЗЕЛЁНОГО CI ПО conclusion (не по коду watch!)
RID=$(gh run list --workflow=ci.yml --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RID --interval 30
gh run view $RID --json conclusion --jq .conclusion     # ДОЛЖНО быть "success"

# 6) Мерж в main
gh pr merge <N> --squash --delete-branch

# 7) Тег на main → запуск релиз-сборки
git checkout main && git fetch origin main -q && git reset --hard origin/main
git show HEAD:package.json | grep '"version"'           # сверить версию
git tag vX.Y.Z && git push origin vX.Y.Z

# 8) Дождаться релиз-сборки и ПРОВЕРИТЬ публикацию по conclusion
RID=$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RID --interval 45
gh run view $RID --json conclusion --jq .conclusion     # "success"
gh release view vX.Y.Z --json tagName,isDraft,assets    # assets: setup.exe/.msi/.sig + latest.json
gh api repos/bglglzd/3uxo/releases/latest --jq .tag_name # == vX.Y.Z
```

Коммиты заканчивать строкой:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## 2. Что делают workflow'ы

### `.github/workflows/ci.yml` (on push / pull_request)
- **frontend** (ubuntu): `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run build`.
- **core** (ubuntu): `cargo test -p uxo-core` (доменная логика, кросс-платформенно).
- **check-app** (windows): `npm run build` + установка LLVM (libclang для whisper-rs)
  + `cargo check -p auris --features whisper,diarize,opus`. Именно здесь
  компилируется весь Tauri-слой и WASAPI/Windows-код (валидация «слепого» Rust).

### `.github/workflows/release.yml` (on tag `v*`, и workflow_dispatch)
- **build-windows** (windows): setup-node, rust-toolchain, LLVM, **Vulkan SDK**,
  `npm ci`, `tauri-apps/tauri-action` с `args: --features gpu,diarize,opus`.
  Подписывает апдейты, публикует НЕ-draft релиз `Auris vX`, прикладывает
  `latest.json` (`includeUpdaterJson: true`).

---

## 3. Авто-обновление

- Endpoint (зашит в `tauri.conf.json`):
  `https://github.com/bglglzd/3uxo/releases/latest/download/latest.json`.
- GitHub `releases/latest` = самый свежий не-draft/не-prerelease релиз. Апдейтер
  всегда ведёт на него — промежуточные версии пользователь «перепрыгивает».
- `latest.json` содержит версию, подписи и URL'ы `Auris_X.Y.Z_x64-setup.exe` /
  `_x64_en-US.msi`. Проверка: `curl -sL <endpoint> | grep version`.

---

## 4. КРИТИЧЕСКИЕ грабли (проверено на практике)

1. **Сверяй `gh run view --json conclusion`, НЕ код выхода `gh run watch`.**
   `gh run watch` однажды завершился 0, пока сборка падала → **v0.5.0 уехал
   сломанным (E0716) и не опубликовался**. Всегда подтверждай `conclusion ==
   success` ПЕРЕД тегом и считай релиз живым только после `gh release view` +
   latest endpoint.
2. **Версию бампить в ОБОИХ файлах** (`package.json` и `tauri.conf.json`), иначе
   рассинхрон.
3. **`mainBinaryName: "Auris"`** в `tauri.conf.json` задаёт имя exe (`Auris.exe`);
   без него имя берётся из Cargo-пакета (`auris`).
4. **Cargo.lock** при переименовании пакета можно править вручную или дать cargo
   перегенерировать (CI без `--locked`).
5. **`gh pr edit --base` ломается** (GraphQL projectCards deprecation). Ретаргет
   базы PR: `gh api -X PATCH repos/bglglzd/3uxo/pulls/N -f base=main`.
6. **Иконки**: `npx tauri icon src-tauri/auris-icon.svg` (принимает SVG напрямую)
   регенерит десктоп-форматы в `src-tauri/icons/`. Mobile (android/ios) — удалять
   (приложение десктопное). Исходник иконки — `src-tauri/auris-icon.svg`.

---

## 5. Откат / починка сломанного релиза

- Если релиз-сборка упала — тег указывает на сломанный коммит, релиз НЕ
  публикуется (latest остаётся прежним, пользователи не затронуты). Чинить:
  фикс на ветке → PR → зелёный CI → мерж → **новый** тег (напр. vX.Y.(Z+1)).
- Тег `vX.Y.0`, который не опубликовался, можно оставить (косметика) или удалить
  (`git push origin :refs/tags/vX.Y.0`). Версию обычно поднимают на патч.
