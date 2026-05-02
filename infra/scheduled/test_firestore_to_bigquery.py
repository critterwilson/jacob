"""Tests for the Firestore → BigQuery loader (T29)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _make_load_job(row_count: int = 5) -> MagicMock:
    job = MagicMock()
    job.result.return_value = None

    table = MagicMock()
    table.num_rows = row_count
    return job, table


def _mock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("BQ_BACKUPS_BUCKET", "jacob-backups-test")
    monkeypatch.setenv("BQ_ANALYTICS_DATASET", "jacob_analytics")


def test_loader_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Running the loader twice for the same date should yield the same row count."""
    _mock_env(monkeypatch)

    load_job = MagicMock()
    load_job.result.return_value = None
    dest_table = MagicMock()
    dest_table.num_rows = 10

    mock_client = MagicMock()
    mock_client.load_table_from_uri.return_value = load_job
    mock_client.get_table.return_value = dest_table

    with patch("google.cloud.bigquery.Client", return_value=mock_client):
        from infra.scheduled.firestore_to_bigquery import run

        rows1 = run(export_date="2026-04-30")
        rows2 = run(export_date="2026-04-30")

    assert rows1 == rows2 == 10
    # WRITE_TRUNCATE means second call overwrites the first — same result.
    assert mock_client.load_table_from_uri.call_count == 2


def test_loader_writes_partition(monkeypatch: pytest.MonkeyPatch) -> None:
    """Loader must use WRITE_TRUNCATE disposition."""
    import google.cloud.bigquery as bq  # type: ignore[import-untyped]

    _mock_env(monkeypatch)

    load_job = MagicMock()
    load_job.result.return_value = None
    dest_table = MagicMock()
    dest_table.num_rows = 7

    mock_client = MagicMock()
    mock_client.load_table_from_uri.return_value = load_job
    mock_client.get_table.return_value = dest_table

    captured_config: list[bq.LoadJobConfig] = []

    def _capture_load(uri: str, table: str, job_config: bq.LoadJobConfig) -> MagicMock:
        captured_config.append(job_config)
        return load_job

    mock_client.load_table_from_uri.side_effect = _capture_load

    with patch("google.cloud.bigquery.Client", return_value=mock_client):
        from infra.scheduled.firestore_to_bigquery import run

        rows = run(export_date="2026-04-30")

    assert rows == 7
    assert len(captured_config) == 1
    assert (
        captured_config[0].write_disposition
        == bq.WriteDisposition.WRITE_TRUNCATE
    )
