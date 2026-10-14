FROM node:18-alpine
# Create app directory and user
RUN mkdir -p /app && chown -R node:node /app
WORKDIR /app
# Switch to non-root user
USER node
# Copy package files
COPY --chown=node:node package*.json ./

# Install dependencies
RUN npm ci --only=production
# Copy app source
COPY --chown=node:node . .
EXPOSE 3000
CMD ["node", "server.js"]