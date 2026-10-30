# Job last updated at / by

**Date:** 2026-10-30  
**Status:** Approved for planning  
**Scope:** Show who last updated a job and when. No last-opened tracking, no stage/state-specific timestamps, no change history UI.

## Goal

On the Jobs page and the task page job list, show a clear **Last updated** line with:

- **when** the job was last updated (`updated_date`)
- **who** updated it (`updated_by`)

Example UI copy: `Updated 2 hours ago by alice` (tooltip shows full absolute datetime).

## Background

CVAT already stores `Job.updated_date` (`TimestampedModel.auto_now`) and bumps it on job saves. There is no `updated_by` field today. The task page already shows a relative “Updated …” string from `updated_date` only; the Jobs page cards do not surface updater identity.

## Data model

Add nullable FK on `Job`:

| Field | Type | Notes |
|-------|------|--------|
| `updated_by` | `ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")` | User who performed the last meaningful job update |

Keep using existing `updated_date` for the timestamp. Do not add stage/state-specific date fields or a `JobView` table in this change.

### When to set `updated_by`

Set `updated_by` to the requesting user whenever a job is updated through the normal write path (`JobWriteSerializer.update` / equivalent API update), including changes to:

- `stage`
- `state`
- `assignee`
- other writable job fields that go through that update path

Do **not** set `updated_by` on touch-only `updated_date` bumps (same class of updates already skipped for analytics `update:job` events), so silent system touches do not attribute a person incorrectly.

Existing jobs remain `updated_by=null` until the next real update; UI shows “Updated … by unknown” or omits “by …” when null.

## API / core

- Expose `updated_by` on `JobReadSerializer` using the same nested user shape as `assignee` (id, username, etc.).
- Keep `updated_date` as today.
- Map both fields in `cvat-core` `Job` / `SerializedJob` so the UI can read them without raw API access.
- Optional: allow ordering/filtering by `updated_date` (already supported). No new filter for `updated_by` required for v1.

## UI

Show last updated at/by in both places:

1. **Jobs page** — `job-card.tsx`
2. **Task page job list** — `job-item.tsx`

Display rules:

- Relative time for the primary text (existing `fromNow` / equivalent).
- Absolute datetime in a tooltip.
- Append `by {username}` when `updated_by` is present.
- When `updated_by` is missing, show time only (no fake user).

Out of scope for UI: CSV columns, analytics tabs, last-opened, full change history.

## Non-goals

- Personal or team “last opened / viewed”
- Separate `stage_updated_date` / `state_updated_date`
- Full audit history UI (existing `update:job` events remain available later)
- CSV export columns

## Testing

- Updating job stage/state/assignee sets `updated_by` to the authenticated user and refreshes `updated_date`.
- Read API returns nested `updated_by` after such an update.
- Jobs card and task job item render “Updated … by …” after reload.
- Jobs with `updated_by=null` still render updated time without crashing.

## Rollout

Requires a Django migration + UI rebuild. No ClickHouse dependency.
