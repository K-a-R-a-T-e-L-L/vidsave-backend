# VidSave: GitHub Actions → GHCR → Dokploy

Оба репозитория опубликованы; workflow автоматически публикует образы и вызывает Dokploy после успешных checks.

## Репозитории и ветки

| Часть    | GitHub                           | Образ                                           | Домен / порт контейнера        |
| -------- | -------------------------------- | ----------------------------------------------- | ------------------------------ |
| Backend  | K-a-R-a-T-e-L-L/vidsave-backend  | ghcr.io/k-a-r-a-t-e-l-l/vidsave-backend:latest  | api.vidsave.karatell.ru / 3001 |
| Frontend | K-a-R-a-T-e-L-L/vidsave-frontend | ghcr.io/k-a-r-a-t-e-l-l/vidsave-frontend:latest | vidsave.karatell.ru / 3000     |

Backend: локальная main, удалённый репозиторий пуст на момент проверки. Frontend: локальная main имеет другую историю, чем существующая удалённая master. Истории не объединялись. Старый remote сохранён как legacy-origin, pushDefault указывает на новый origin. Перед будущим первым push нужно отдельно согласовать перенос истории/default branch; force push не нужен и не выполнялся.

## CI/CD

Оба workflow запускают проверки для PR и push main/master; ручной запуск также доступен. Оба репозитория публикуют образ и запускают деплой автоматически из default branch после успешного checks, без DEPLOY_ENABLED. PR не запускает публикацию и деплой.

Проверки: Node22/npm ci, lint, format, build, typecheck, тесты, Docker build без публикации. Frontend: Chromium через xvfb, SSR и браузерный сценарий с fixture API. Backend: unit и integration с отдельной PostgreSQL16 service на порту5433. Продакшен credentials в CI не используются.

CD: образ latest и отдельный тег полного commit SHA в GHCR, затем POST на вебхук Dokploy, заданный в .github/scripts/deploy.mjs. Actions закреплены по SHA, packages:write выдан только job публикации, PR не запускает publish-and-deploy. Запуски одной ветки последовательны. HTTP301/ошибки/таймаут вебхука не считаются успехом; автоматических повторных деплоев нет. Принятый webhook означает постановку в очередь, готовность приложения проверяется в Dokploy.

## Настройка перед включением

1. Вебхуки frontend/backend заданы в .github/scripts/deploy.mjs соответствующего репозитория по прямому запросу владельца. GitHub Secret DOKPLOY_DEPLOY_WEBHOOK не требуется. URL видны в публичном коде; Environment production сохраняется для истории деплоев.
2. В Dokploy выбрать Docker image provider с соответствующим образом :latest, Auto Deploy включить (этого требует webhook). Прямой GitHub push webhook дополнительно не подключать: деплой вызывается только после CI. Для private GHCR настроить registry credentials с read:packages. Сборка в Dokploy не требуется.
3. Назначить указанные домены и HTTPS соответствующим container ports. API hostname именно api.vidsave.karatell.ru, независимо от ошибочной ссылки в исходном сообщении. DNS и сертификаты пока не изменялись. Контейнер frontend держать в одном экземпляре, как требует текущая auth refresh архитектура.
4. Внести runtime variables из .env.production.example каждой части. Реальные DATABASE_PASSWORD/JWT_SECRET/S3 keys хранить в Dokploy, не в образе/build args. Сначала настроить PostgreSQL/backend, затем frontend. BACKEND_INTERNAL_URL — origin без /api; можно заменить на приватный DNS сервиса Dokploy.
5. До S3 подключить постоянный volume к /app/var/media backend (UID1000). PostgreSQL также требует постоянного volume. Автоматическая synchronize:true сохранена по требованию владельца; миграций нет. Перед релизом с изменением схемы делать резервную копию БД.
6. В обоих репозиториях push в default branch или ручной запуск workflow автоматически запускает публикацию и деплой после checks.

DEPLOY_ENABLED не требуется ни для backend, ни для frontend. Для отката выбрать предыдущий SHA-tag в Dokploy; latest сам по себе не является резервной копией. Перед возвращением автоматического режима снова выбрать latest.

## FirstVDS S3

Backend уже поддерживает S3-compatible API. Подготовлены MEDIA_S3_ENDPOINT, MEDIA_S3_REGION, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY, MEDIA_S3_FORCE_PATH_STYLE. Значения брать из раздела «Доступы» услуги. Регион в примере FirstVDS — default; точный endpoint не угадывается: провайдер менял домены, публичный URL объекта не обязательно является API endpoint.

Создать приватный bucket. Browser не обращается к нему напрямую: API проверяет публикацию, поэтому публичный bucket и CORS для браузера не нужны. В шаблоне bucket/credentials закомментированы, до их заполнения сохраняется локальное хранилище. MEDIA_S3_FORCE_PATH_STYLE=true повторяет проверенную структуру клиента из sigmadrun-backend: bucket передаётся в пути запроса, а endpoint остаётся общим адресом S3 API. Регион auto из Cloudflare R2 не переносится: для FirstVDS в шаблоне default, уточняется по реквизитам. Публичные бакеты и presigned read URLs из другого продукта не переносятся: в VidSave нужна немедленная проверка публикации.

Ранее загруженные local/ файлы автоматически в S3 не переносятся. Сохранить старый volume: ключи local/ продолжат читаться оттуда, новые файлы после настройки bucket будут записываться в S3. Перенос старых данных — отдельная операция.

Проверка после реального подключения: загрузить draft image, убедиться что публично404; опубликовать материал и проверить изображение/превью; скрыть и проверить404; удалить материал и неиспользуемое изображение. Настоящий FirstVDS bucket пока не подключён и не тестировался.

Источники: [Dokploy auto-deploy](https://docs.dokploy.com/docs/core/auto-deploy), [FirstVDS S3 реквизиты](https://firstvds.ru/technology/upravlenie-obektnym-khranilischem-s-pomoschyu-s3cmd).

## Telegram через зарубежный прокси

В runtime environment backend задайте `TELEGRAM_PROXY_URL=http://username:password@proxy.example.com:8888` вместе с `TELEGRAM_BOT_TOKEN` и `TELEGRAM_LEADS_CHAT_ID`. Используйте реальный зарубежный HTTP(S) CONNECT proxy; специальные символы логина/пароля кодируйте percent-encoding. Храните URL как секрет, не коммитьте его. Пустая переменная оставляет прямую отправку.

Прокси применяется только к Telegram. При его отказе прямого обхода нет: уведомление повторяется через существующую outbox-очередь (до 8 попыток), заявка сохраняется в PostgreSQL. В Telegram отправляется только ID заявки. `TELEGRAM_API_BASE_URL` — адрес Bot API, а не адрес CONNECT proxy. В рабочем окружении оставляйте стандартный HTTPS Bot API. TLS-проверка сертификатов включена. Реальная доставка требует настроенного прокси и Telegram credentials; локальные тесты не отправляют сообщений.
