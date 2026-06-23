# Axta RAG Engine

Axta RAG Engine adalah **Local RAG-as-a-Service (Retrieval-Augmented Generation) Engine** tingkat produksi yang dirancang untuk arsitektur multi-tenant. Dibangun menggunakan **Express, TypeScript, PostgreSQL, Qdrant Vector Database, dan Ollama**.

Sistem ini memfasilitasi penyerapan dokumen (PDF/TXT), ekstraksi teks otomatis, pembuatan koordinat semantik (vector embedding), penyimpanan vektor terisolasi, pencarian semantik (search), serta telemetri admin dengan proteksi rem darurat (*emergency brake*).

---

## 🌟 Value Proposition (Nilai Jual Utama)

*   **Multi-Tenancy Tingkat Tinggi**: Isolasi data antar-klien dijamin aman dari tingkat API Gateway (API Key Guard), database metadata relasional (PostgreSQL UUID), hingga filter payload query database vektor (Qdrant).
*   **Cost Efficiency Rp0 (Offline AI)**: Seluruh pemrosesan kecerdasan buatan berjalan lokal tanpa ketergantungan pada API berbayar (seperti OpenAI/Cohere). Ingestion dan pencarian semantik memanfaatkan local LLM embedding model `nomic-embed-text` yang disajikan via **Ollama**.
*   **Keamanan Kontainer Mutlak**: Dikonfigurasi menggunakan Multi-stage Dockerfile yang meminimalkan ukuran image Alpine dan dijalankan dengan user non-root `node` untuk mencegah eksploitasi container breakout.
*   **Telemetri & Abuse Control**: Dilengkapi dengan dasbor metrik admin lintas database (PostgreSQL & Qdrant) untuk mendeteksi drift data, serta tombol blokir instan (*emergency brake*) kunci API tenant jika terdeteksi penyalahgunaan.

---

## 🏗️ Arsitektur Sistem

Alur kerja penyerapan data (*Ingestion*) dan pencarian semantik (*Retrieval*) digambarkan melalui diagram ASCII berikut:

```text
+-------------------------------------------------------------+
|                        Client App                           |
+-----------------------------+-------------------------------+
                               |
           [ POST /upload ]    |      [ POST /search ]
           X-Axta-API-Key      |      X-Axta-API-Key
                               v
+-------------------------------------------------------------+
|                     API Gateway (Express)                   |
|                                                             |
|   +-----------------------------------------------------+   |
|   |        AuthMiddleware (API Key Guard)               |   |
|   |   - Kueri PostgreSQL untuk verifikasi Key & Org UUID|   |
|   +--------------------------+--------------------------+   |
|                              |                              |
|                              v (Injeksi req.orgId)          |
|   +--------------------------+--------------------------+   |
|   |       Document Controller & Ingestion Engine        |   |
|   |                                                     |   |
|   |  [Ingestion Pipeline]       [Retrieval Pipeline]    |   |
|   |  - Ekstraksi PDF (memory)   - Konversi kueri teks   |   |
|   |  - Sliding Window Chunking    menjadi vektor        |   |
|   |  - Batch Embed (Ollama)     - Vector search Qdrant  |   |
|   |  - Simpan Vektor Qdrant       dengan filter Org UUID|   |
|   +---------+-----------+-----------------+-------------+   |
|             |           |                 |                 |
+-------------|-----------|-----------------|-----------------+
              |           |                 |
              v (SQL)     v (Vector API)    v (Vector Search)
        +-----+----+    +-+------+    +-----+----+
        | Postgres |    | Ollama |    |  Qdrant  |
        | Relational|   | Local  |    |  Vector  |
        | Metadata |    | LLM/Emb|    |    DB    |
        +----------+    +--------+    +----------+
```

---

## 🚀 Panduan Memulai Cepat (Quick Start)

### Prasyarat
*   Docker & Docker Compose terinstal pada mesin host.

### Langkah 1: Kloning Repositori & Konfigurasi Env
Salin file `.env.example` menjadi `.env` di direktori utama:
```bash
cp .env.example .env
```

### Langkah 2: Nyalakan Kontainer Produksi
Jalankan seluruh stack kontainer (App Express, PostgreSQL, Qdrant, Ollama) di latar belakang:
```bash
docker compose -f docker-compose.prod.yml up -d
```

### Langkah 3: Unduh Model Embedding di Ollama
Ollama memerlukan model embedding untuk diunduh pertama kali di dalam container-nya:
```bash
docker exec -it axta-prod-ollama ollama pull nomic-embed-text
```

### Langkah 4: Migrasi Skema Database Relasional
Terapkan skema database ke database PostgreSQL produksi:
```bash
docker exec -i axta-prod-postgres psql -U axta_user -d axta_rag_db < src/config/schema.sql
```

Aplikasi RAG kini aktif dan berjalan pada port `3000`!

---

## 🔌 Referensi REST API

### 1. Unggah Dokumen (PDF/TXT)
Menerima file `.pdf` atau `.txt` via multipart form-data.
*   **Endpoint**: `POST /api/documents/upload`
*   **Headers**:
    *   `X-Axta-API-Key`: `ak_alpha_123`
*   **Body (Form Data)**:
    *   `file`: (Pilih berkas PDF/TXT Anda)
    *   `collectionName`: `test_collection` (Opsional)
    *   `metadata`: `{"author": "John Doe"}` (Opsional, JSON string)

**Contoh Curl**:
```bash
curl -X POST http://localhost:3000/api/documents/upload \
  -H "X-Axta-API-Key: ak_alpha_123" \
  -F "file=@/path/to/dokumen.pdf" \
  -F "collectionName=test_collection"
```

---

### 2. Pencarian Semantik Terisolasi (Search)
Mencari potongan teks paling mirip dengan filter keamanan tenant organisasi secara otomatis.
*   **Endpoint**: `POST /api/documents/search`
*   **Headers**:
    *   `Content-Type`: `application/json`
    *   `X-Axta-API-Key`: `ak_alpha_123`
*   **Body (JSON)**:
```json
{
  "query": "Jelaskan tentang cara kerja RAG semantik",
  "collectionName": "test_collection",
  "limit": 3
}
```

**Contoh Curl**:
```bash
curl -X POST http://localhost:3000/api/documents/search \
  -H "Content-Type: application/json" \
  -H "X-Axta-API-Key: ak_alpha_123" \
  -d '{"query": "Keuangan kuartal ke-3", "collectionName": "test_collection", "limit": 2}'
```

---

### 3. Dasbor Telemetri Sistem (Khusus Admin)
Menampilkan statistik agregasi database relasional dan verifikasi sinkronisasi vektor Qdrant.
*   **Endpoint**: `GET /api/admin/metrics`
*   **Headers**:
    *   `X-Admin-Token`: `admin_secret_token_123`

**Contoh Curl**:
```bash
curl -X GET http://localhost:3000/api/admin/metrics \
  -H "X-Admin-Token: admin_secret_token_123"
```

---

### 4. Tombol Rem Darurat Admin (Emergency Key Toggle)
Memblokir atau mengaktifkan kembali akses API Key tenant secara instan jika terdeteksi abuse.
*   **Endpoint**: `PATCH /api/admin/api-keys/:id/toggle`
*   **Headers**:
    *   `Content-Type`: `application/json`
    *   `X-Admin-Token`: `admin_secret_token_123`
*   **Body (JSON)**:
```json
{
  "is_active": false
}
```

**Contoh Curl**:
```bash
curl -X PATCH http://localhost:3000/api/admin/api-keys/4c2ac791-d588-4f64-8a4b-7b0c9d855f94/toggle \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: admin_secret_token_123" \
  -d '{"is_active": false}'
```

---

## 🛠️ Lisensi
Axta RAG Engine dilisensikan di bawah **Apache-2.0**.
