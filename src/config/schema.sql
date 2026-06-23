-- 1. Tabel Organisasi (Tenant Profile)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabel API Keys (Pengamanan Endpoint Per Tenant)
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) UNIQUE NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indeks unik untuk mempercepat kueri pencarian kunci API (B-Tree Index)
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

-- 3. Tabel Dokumen (Metadata & Riwayat Ingestion)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    total_chunks INTEGER DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'processing', -- 'processing', 'completed', 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indeks untuk mempercepat kueri pencarian dokumen berdasarkan tenant
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(organization_id);

-- 4. Seed Data Uji Coba (Memudahkan Pengujian Integrasi Otomatis)
INSERT INTO organizations (id, name) VALUES 
('11111111-1111-1111-1111-111111111111', 'Tenant Alpha'),
('22222222-2222-2222-2222-222222222222', 'Tenant Beta'),
('33333333-3333-3333-3333-333333333333', 'Tenant Gamma')
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_keys (key, organization_id) VALUES 
('ak_alpha_123', '11111111-1111-1111-1111-111111111111'),
('ak_beta_456', '22222222-2222-2222-2222-222222222222'),
('ak_gamma_789', '33333333-3333-3333-3333-333333333333')
ON CONFLICT (key) DO NOTHING;
