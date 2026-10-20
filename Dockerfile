# NOVA in a container. Node 22 has SQLite built in, so the image needs no other packages and runs no npm install.
#   docker build -t nova .
#   docker run -d --name nova -p 127.0.0.1:8787:8787 -v nova-data:/data --env-file .env.docker nova
# Inside a container NOVA listens on 0.0.0.0, so the local "development sign-in" is not allowed: use AUTH_MODE=google
# with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and BASE_URL (see DEPLOYMENT.md).
FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 NOVA_DB=/data/nova.db AUTH_MODE=google
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
