-- Threes! ランキング用テーブル作成SQL
-- GitHub Pages版（Edge Functions不要、直接書き込み許可）

-- スコアランキングテーブル
CREATE TABLE IF NOT EXISTS rankings (
    id BIGSERIAL PRIMARY KEY,
    client_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('normal', 'with_undo', 'anything_goes')),
    max_tile INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- 各カテゴリで1ユーザー1レコードの制約
    UNIQUE(client_id, category)
);

-- プレイ回数ランキングテーブル
CREATE TABLE IF NOT EXISTS play_counts (
    id BIGSERIAL PRIMARY KEY,
    client_id TEXT UNIQUE NOT NULL,
    player_name TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_rankings_category_score ON rankings(category, score DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_client_id ON rankings(client_id);
CREATE INDEX IF NOT EXISTS idx_play_counts_play_count ON play_counts(play_count DESC);

-- Row Level Security (RLS) を有効化
ALTER TABLE rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_counts ENABLE ROW LEVEL SECURITY;

-- 読み取りポリシー（全員が読み取り可能）
CREATE POLICY "Anyone can read rankings" ON rankings
    FOR SELECT TO anon USING (true);

CREATE POLICY "Anyone can read play_counts" ON play_counts
    FOR SELECT TO anon USING (true);

-- 書き込みポリシー（anon keyで書き込み可能）
CREATE POLICY "Anyone can insert rankings" ON rankings
    FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anyone can insert play_counts" ON play_counts
    FOR INSERT TO anon WITH CHECK (true);

-- play_countsのupsert用に更新も許可
CREATE POLICY "Anyone can update own play_counts" ON play_counts
    FOR UPDATE TO anon USING (true);

-- rankingsのupsert用に更新も許可（ハイスコア時のみ上書き）
CREATE POLICY "Anyone can update own rankings" ON rankings
    FOR UPDATE TO anon USING (true);
