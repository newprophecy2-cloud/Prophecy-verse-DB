-- Prophecy Verse D1 Database
-- Based on APK Room Database v11
-- Shared catalog and stream data only

PRAGMA foreign_keys = ON;

-- =========================================
-- 1. ANIME / MOVIE METADATA
-- =========================================

CREATE TABLE IF NOT EXISTS anime_entries (
    id TEXT PRIMARY KEY,
    aniListId INTEGER,
    backendAnimeId TEXT,
    titleRomaji TEXT,
    titleEnglish TEXT,
    titleNative TEXT,
    preferredTitle TEXT NOT NULL,
    synopsis TEXT,
    year TEXT,
    season TEXT,
    format TEXT,
    status TEXT,
    genres TEXT NOT NULL DEFAULT '',
    score REAL,
    episodeCount INTEGER,
    duration INTEGER,
    studios TEXT,
    posterUrl TEXT,
    bannerUrl TEXT,
    isPlayable INTEGER NOT NULL DEFAULT 0,
    isTrending INTEGER NOT NULL DEFAULT 0,
    isSeasonal INTEGER NOT NULL DEFAULT 0,
    isPopular INTEGER NOT NULL DEFAULT 0,
    mediaCategory TEXT NOT NULL DEFAULT 'ANIME',
    metadataCompleteness TEXT NOT NULL DEFAULT 'UNKNOWN',
    canonicalAnimeId INTEGER,
    canonicalTitle TEXT,
    canonicalSeasonNumber INTEGER,
    cumulativeEpisodeOffset INTEGER,
    updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anime_anilist
ON anime_entries(aniListId);

CREATE INDEX IF NOT EXISTS idx_anime_backend
ON anime_entries(backendAnimeId);

CREATE INDEX IF NOT EXISTS idx_anime_trending
ON anime_entries(isTrending);

CREATE INDEX IF NOT EXISTS idx_anime_seasonal
ON anime_entries(isSeasonal);

CREATE INDEX IF NOT EXISTS idx_anime_popular
ON anime_entries(isPopular);

CREATE INDEX IF NOT EXISTS idx_anime_playable
ON anime_entries(isPlayable);


-- =========================================
-- 2. ANIME ALIASES
-- =========================================

CREATE TABLE IF NOT EXISTS anime_aliases (
    aliasId INTEGER PRIMARY KEY AUTOINCREMENT,
    animeId TEXT NOT NULL,
    alias TEXT NOT NULL,
    originalAlias TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alias_anime
ON anime_aliases(animeId);

CREATE INDEX IF NOT EXISTS idx_alias_value
ON anime_aliases(alias);


-- =========================================
-- 3. CATALOG MAPPINGS
-- =========================================

CREATE TABLE IF NOT EXISTS catalog_mappings (
    aniListId INTEGER PRIMARY KEY,
    backendAnimeId TEXT NOT NULL,
    confidence REAL NOT NULL,
    mappedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mapping_backend
ON catalog_mappings(backendAnimeId);


-- =========================================
-- 4. SEASONS
-- =========================================

CREATE TABLE IF NOT EXISTS season_entries (
    id TEXT PRIMARY KEY,
    animeId TEXT NOT NULL,
    seasonNumber INTEGER NOT NULL,
    backendSeasonId TEXT,
    title TEXT
);

CREATE INDEX IF NOT EXISTS idx_season_anime
ON season_entries(animeId);


-- =========================================
-- 5. EPISODES
-- =========================================

CREATE TABLE IF NOT EXISTS episode_entries (
    id TEXT PRIMARY KEY,
    animeId TEXT NOT NULL,
    seasonNumber INTEGER NOT NULL,
    episodeNumber INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    isAvailable INTEGER NOT NULL DEFAULT 1,
    sourceEpisodeIds TEXT
);

CREATE INDEX IF NOT EXISTS idx_episode_anime
ON episode_entries(animeId);

CREATE INDEX IF NOT EXISTS idx_episode_anime_season
ON episode_entries(animeId, seasonNumber);


-- =========================================
-- 6. STREAM CONTAINERS
-- =========================================

CREATE TABLE IF NOT EXISTS stream_containers (
    scopeKey TEXT PRIMARY KEY,
    contentKey TEXT NOT NULL,
    anilistId INTEGER,
    contentType TEXT NOT NULL,
    backendId TEXT,
    canonicalTitle TEXT,
    seasonCount INTEGER,
    totalEpisodeCount INTEGER,
    providerCount INTEGER NOT NULL DEFAULT 0,
    sourceCount INTEGER NOT NULL DEFAULT 0,
    discoveryStatus TEXT NOT NULL DEFAULT 'NOT_DISCOVERED',
    version INTEGER NOT NULL DEFAULT 1,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_container_content
ON stream_containers(contentKey);

CREATE INDEX IF NOT EXISTS idx_container_anilist
ON stream_containers(anilistId);

CREATE INDEX IF NOT EXISTS idx_container_backend
ON stream_containers(backendId);

CREATE INDEX IF NOT EXISTS idx_container_type
ON stream_containers(contentType);


-- =========================================
-- 7. STREAM SEASONS
-- =========================================

CREATE TABLE IF NOT EXISTS stream_seasons (
    seasonDocKey TEXT PRIMARY KEY,
    contentKey TEXT NOT NULL,
    seasonId TEXT NOT NULL,
    seasonNumber INTEGER NOT NULL,
    backendSeasonId TEXT,
    episodeCount INTEGER NOT NULL DEFAULT 0,
    discoveryStatus TEXT NOT NULL DEFAULT 'NOT_DISCOVERED',
    version INTEGER NOT NULL DEFAULT 1,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stream_season_content
ON stream_seasons(contentKey);

CREATE INDEX IF NOT EXISTS idx_stream_season_number
ON stream_seasons(contentKey, seasonNumber);


-- =========================================
-- 8. STREAM EPISODES
-- =========================================

CREATE TABLE IF NOT EXISTS stream_episodes (
    episodeDocKey TEXT PRIMARY KEY,
    contentKey TEXT NOT NULL,
    seasonId TEXT NOT NULL,
    episodeId TEXT NOT NULL,
    catalogEpisodeId TEXT,
    seasonNumber INTEGER NOT NULL,
    episodeNumber INTEGER NOT NULL,
    backendEpisodeId TEXT,
    backendSourceEpisodeIds TEXT,
    providerCount INTEGER NOT NULL DEFAULT 0,
    sourceCount INTEGER NOT NULL DEFAULT 0,
    discoveryStatus TEXT NOT NULL DEFAULT 'NOT_DISCOVERED',
    version INTEGER NOT NULL DEFAULT 1,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stream_episode_content
ON stream_episodes(contentKey);

CREATE INDEX IF NOT EXISTS idx_stream_episode_order
ON stream_episodes(contentKey, seasonNumber, episodeNumber);

CREATE INDEX IF NOT EXISTS idx_stream_episode_catalog
ON stream_episodes(catalogEpisodeId);


-- =========================================
-- 9. STREAM PROVIDERS
-- =========================================

CREATE TABLE IF NOT EXISTS stream_providers (
    providerDocKey TEXT PRIMARY KEY,
    scopeKey TEXT NOT NULL,
    providerId TEXT NOT NULL,
    providerName TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    sourceCount INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_provider_scope
ON stream_providers(scopeKey);

CREATE INDEX IF NOT EXISTS idx_provider_id
ON stream_providers(providerId);


-- =========================================
-- 10. STREAM SOURCES
-- =========================================

CREATE TABLE IF NOT EXISTS stream_sources (
    sourceDocKey TEXT PRIMARY KEY,
    scopeKey TEXT NOT NULL,
    providerId TEXT NOT NULL,
    sourceId TEXT NOT NULL,
    sourceName TEXT NOT NULL,
    backendEpisodeId TEXT,
    streamUrl TEXT,
    urlType TEXT NOT NULL DEFAULT 'direct',
    contentType TEXT,
    quality TEXT,
    codec TEXT,
    audioLanguage TEXT,
    downloadable INTEGER,
    sizeBytes INTEGER,
    safeHeadersJson TEXT,
    expiresAt TEXT,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    version INTEGER NOT NULL DEFAULT 1,
    lastVerifiedAt INTEGER,
    lastPlaybackSuccessAt INTEGER,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_source_scope
ON stream_sources(scopeKey);

CREATE INDEX IF NOT EXISTS idx_source_provider
ON stream_sources(providerId);

CREATE INDEX IF NOT EXISTS idx_source_id
ON stream_sources(sourceId);

CREATE INDEX IF NOT EXISTS idx_source_status
ON stream_sources(status);
