# ==========================================
# STAGE 1: Build / Compilation Stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Salin manifest dependensi terlebih dahulu demi efisiensi cache layer Docker
COPY package*.json tsconfig.json ./

# Install seluruh dependencies (termasuk devDependencies untuk kompilasi tsc)
RUN npm ci

# Salin seluruh kode sumber proyek
COPY src/ ./src

# Kompilasi TypeScript ke JavaScript (hasil compile diletakkan di folder /dist)
RUN npm run build

# Pangkas devDependencies, hanya menyisakan runtime dependencies produksi
RUN npm prune --production

# ==========================================
# STAGE 2: Runner Stage (Production Runner)
# ==========================================
FROM node:20-alpine AS runner

# Mengatur environment produksi
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Salin manifest dan runtime node_modules produksi dari stage builder
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Menggunakan user non-root 'node' bawaan image Alpine demi keamanan container
USER node

# Expose port aplikasi Express
EXPOSE 3000

# Jalankan aplikasi Express produksi
CMD ["node", "dist/index.js"]
