FROM nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.source=https://github.com/idoknow/guilinol
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
RUN nginx -t
