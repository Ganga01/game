FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/runtime && chown node:node /app/runtime
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/runtime
EXPOSE 3000
CMD ["npm", "start"]
