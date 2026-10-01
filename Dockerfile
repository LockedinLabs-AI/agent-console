FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2

WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node public/ ./public/
# The licence, and the notices for what ships inside (the IBM Plex fonts in public/).
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./

RUN mkdir -p /home/dev/.agent-console/hub && chown -R node:node /home/dev
ENV HOME=/home/dev
# The reporting port is fixed in the image, so a restart never moves it away
# from what machines were given and the healthcheck always knows where to look.
ENV AGENT_CONSOLE_REPORT_PORT=6788
USER node
VOLUME ["/home/dev/.agent-console/hub"]
EXPOSE 6788
# Healthy means the reporting listener answers its join page; the console
# page itself only ever listens on loopback.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.AGENT_CONSOLE_REPORT_PORT+'/join',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "bin/agent-console.mjs"]
CMD ["--no-local", "--listen", "0.0.0.0"]
