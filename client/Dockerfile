# Статика под nginx с собственными заголовками кэширования: nixpacks своей
# конфигурацией управлять не даёт, а без неё браузеры держат старый index.html.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

# Служебные файлы сборки в раздаче не нужны.
RUN rm -f /usr/share/nginx/html/Dockerfile \
          /usr/share/nginx/html/nginx.conf \
          /usr/share/nginx/html/.dockerignore \
    && rm -rf /usr/share/nginx/html/.vscode

EXPOSE 80
