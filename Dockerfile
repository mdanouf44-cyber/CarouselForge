FROM ghcr.io/puppeteer/puppeteer:22.11.0

# Switch to root to set up directory permissions
USER root
WORKDIR /usr/src/app

# Copy dependency files
COPY package*.json ./

# Install npm dependencies
RUN npm ci

# Copy the rest of the application files
COPY . .

# Ensure the app folder is owned by the Puppeteer container user for safety
RUN chown -R pptruser:pptruser /usr/src/app

# Switch back to the secure, unprivileged Puppeteer user
USER pptruser

# Expose the dashboard port
EXPOSE 3000

# Start the unified bot & scheduler server
CMD ["node", "src/server.js"]
