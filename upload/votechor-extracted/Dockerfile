FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN npm ci --workspace @votechor/server --workspace @votechor/shared --include-workspace-root
ENV PORT=2567
EXPOSE 2567
CMD ["npx","tsx","apps/server/src/index.ts"]
