-- BigQuery views for T29 sticker analytics.
-- All views use CREATE OR REPLACE and are idempotent.
-- Run after the external table is created (see bigquery.tf).
--
-- External table definition (Terraform creates this):
--   `jacob_analytics.messages_raw_external`
--   Backed by gs://jacob-backups-{env}/daily/{YYYY-MM-DD}/all_namespaces/all_kinds/output-*
--   Schema inferred from Firestore export format.

-- ── messages_daily ────────────────────────────────────────────────────────────
-- Aggregates top-level (non-thread) message counts per group per day.
-- Excludes soft-deleted messages and thread replies.

CREATE OR REPLACE VIEW `${project}.jacob_analytics.messages_daily` AS
SELECT
  JSON_EXTRACT_SCALAR(data, '$.groupId')   AS groupId,
  DATE(TIMESTAMP_MICROS(CAST(JSON_EXTRACT_SCALAR(data, '$.createdAt.__time__') AS INT64))) AS day,
  COUNT(*)                                  AS count,
  COUNT(DISTINCT JSON_EXTRACT_SCALAR(data, '$.authorUid')) AS distinctAuthorCount
FROM `${project}.jacob_analytics.messages_raw_external`
WHERE
  -- Only top-level messages (not thread replies)
  JSON_EXTRACT_SCALAR(data, '$.parentMessageId') IS NULL
  AND JSON_EXTRACT_SCALAR(data, '$.deletedAt')   IS NULL
GROUP BY groupId, day;


-- ── sticker_mix_weekly ────────────────────────────────────────────────────────
-- Counts how many times each sticker slug was used per group per ISO week.

CREATE OR REPLACE VIEW `${project}.jacob_analytics.sticker_mix_weekly` AS
WITH exploded AS (
  SELECT
    JSON_EXTRACT_SCALAR(data, '$.groupId') AS groupId,
    DATE_TRUNC(
      DATE(TIMESTAMP_MICROS(CAST(JSON_EXTRACT_SCALAR(data, '$.createdAt.__time__') AS INT64))),
      WEEK(MONDAY)
    ) AS weekStart,
    sticker
  FROM `${project}.jacob_analytics.messages_raw_external`,
    UNNEST(JSON_EXTRACT_ARRAY(data, '$.stickerIds')) AS sticker
  WHERE
    JSON_EXTRACT_SCALAR(data, '$.parentMessageId') IS NULL
    AND JSON_EXTRACT_SCALAR(data, '$.deletedAt')   IS NULL
)
SELECT
  groupId,
  weekStart,
  REPLACE(REPLACE(sticker, '"', ''), '/', '') AS stickerSlug,
  COUNT(*) AS count
FROM exploded
GROUP BY groupId, weekStart, stickerSlug;


-- ── top_contributors_weekly ───────────────────────────────────────────────────
-- Ranks authors by message count per group per ISO week.

CREATE OR REPLACE VIEW `${project}.jacob_analytics.top_contributors_weekly` AS
SELECT
  JSON_EXTRACT_SCALAR(data, '$.groupId')   AS groupId,
  DATE_TRUNC(
    DATE(TIMESTAMP_MICROS(CAST(JSON_EXTRACT_SCALAR(data, '$.createdAt.__time__') AS INT64))),
    WEEK(MONDAY)
  ) AS weekStart,
  JSON_EXTRACT_SCALAR(data, '$.authorUid') AS authorUid,
  COUNT(*) AS count
FROM `${project}.jacob_analytics.messages_raw_external`
WHERE
  JSON_EXTRACT_SCALAR(data, '$.parentMessageId') IS NULL
  AND JSON_EXTRACT_SCALAR(data, '$.deletedAt')   IS NULL
GROUP BY groupId, weekStart, authorUid;
