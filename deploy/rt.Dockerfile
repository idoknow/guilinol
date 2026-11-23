FROM node:20-alpine

# 联机服务只有一个进程、一个内存房间，多副本会把玩家劈成两半，所以固定单副本部署
WORKDIR /app
ENV NODE_ENV=production PORT=8790

COPY rt/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY rt/server-realtime.mjs ./

USER node
EXPOSE 8790
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server-realtime.mjs"]
