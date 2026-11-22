FROM nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.source=https://github.com/idoknow/guilinol
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
RUN nginx -t

# nginx 收到 SIGTERM 会 fast shutdown、直接断掉在途连接；SIGQUIT 才是优雅退出
STOPSIGNAL SIGQUIT
