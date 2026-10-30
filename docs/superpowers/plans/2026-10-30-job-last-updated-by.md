# Job Last Updated At / By Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record who last updated a job and show `Updated {relative time} by {username}` on Jobs page cards and task page job rows.

**Architecture:** Add nullable `Job.updated_by` FK, set it in `JobWriteSerializer.update` from `request.user` on real API updates, expose it via `JobReadSerializer` / cvat-core, and render it beside the existing relative `updated_date` text in the two job list UIs.

**Tech Stack:** Django / DRF, cvat-core TypeScript, React (antd) CVAT UI

## Global Constraints

- Scope is **only** last updated at + by (no last-opened, no stage/state-specific timestamps, no history UI, no CSV columns).
- Reuse existing `updated_date`; do not invent a second timestamp field.
- When `updated_by` is null, show time only (omit `by …`).
- Do not set `updated_by` on touch-only `updated_date` bumps outside `JobWriteSerializer.update`.
- Follow existing assignee/`BasicUserSerializer` nesting for the user payload.

## File map

| File | Responsibility |
|------|----------------|
| `cvat/apps/engine/models.py` | Add `Job.updated_by` FK |
| `cvat/apps/engine/migrations/0107_job_updated_by.py` | Schema migration |
| `cvat/apps/engine/serializers.py` | Read expose + write set on update |
| `cvat/apps/engine/views.py` | `select_related("updated_by")` for list/retrieve |
| `tests/python/rest_api/test_jobs.py` | API regression for updated_by |
| `cvat-core/src/server-response-types.ts` | `SerializedJob.updated_by` |
| `cvat-core/src/session.ts` | Job `updatedBy` getter + reinit |
| `cvat-ui/src/components/job-item/job-item.tsx` | Task page display |
| `cvat-ui/src/components/jobs-page/job-card.tsx` | Jobs page display |
| `cvat-ui/src/components/jobs-page/styles.scss` | Minor layout for new line |

---

### Task 1: Model + migration for `Job.updated_by`

**Files:**
- Modify: `cvat/apps/engine/models.py` (class `Job` ~1337)
- Create: `cvat/apps/engine/migrations/0107_job_updated_by.py`
- Test: migration check / model field presence

**Interfaces:**
- Consumes: existing `User` import in `models.py`
- Produces: `Job.updated_by` → `ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")`

- [ ] **Step 1: Add the field on `Job`**

In `cvat/apps/engine/models.py`, inside class `Job`, after `parent_job` (before the RelatedManager annotations), add:

```python
    updated_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
```

- [ ] **Step 2: Generate / write migration `0107_job_updated_by.py`**

Prefer:

```bash
cd /Users/gulshangupta/Documents/guardex_project/cvat
python manage.py makemigrations engine --name job_updated_by
```

If makemigrations is unavailable in this environment, create:

```python
# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("engine", "0106_add_interval_annotations"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="job",
            name="updated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
```

Confirm latest dependency is whatever `0106_*` (or newer) is on this branch before committing.

- [ ] **Step 3: Verify migration graph**

```bash
python manage.py showmigrations engine | tail -5
```

Expected: `0107_job_updated_by` listed (possibly `[ ]` until applied).

- [ ] **Step 4: Commit**

```bash
git add cvat/apps/engine/models.py cvat/apps/engine/migrations/0107_job_updated_by.py
git commit -m "$(cat <<'EOF'
feat(engine): add Job.updated_by field

EOF
)"
```

---

### Task 2: Serializer write/read + queryset select_related

**Files:**
- Modify: `cvat/apps/engine/serializers.py` (`JobReadSerializer` ~1157, `JobWriteSerializer.update` ~1585)
- Modify: `cvat/apps/engine/views.py` (`JobViewSet.get_queryset` ~2277)
- Test: `tests/python/rest_api/test_jobs.py`

**Interfaces:**
- Consumes: `Job.updated_by`
- Produces: API field `updated_by: BasicUserSerializer | null` on job reads; set on PATCH updates from `request.user`

- [ ] **Step 1: Write the failing API test**

Add to `tests/python/rest_api/test_jobs.py` inside the class that already contains `test_can_update_assignee_updated_date_on_assignee_updates` (same fixtures style: `admin_user`, `jobs`):

```python
    def test_can_set_updated_by_on_job_state_update(self, admin_user, jobs, users):
        job = next(j for j in jobs if j.get("state") != "completed")
        with make_api_client(admin_user) as api_client:
            _, response = api_client.jobs_api.partial_update(
                job["id"],
                patched_job_write_request={"state": "completed"},
                _parse_response=False,
            )
            assert response.status == HTTPStatus.OK
            data = json.loads(response.data)
            assert data["updated_by"] is not None
            assert data["updated_by"]["username"] == admin_user
            assert data["updated_date"] != job["updated_date"]
```

Use raw JSON (`_parse_response=False`) so the test does not depend on regenerating the Python SDK for the new field.

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/python/rest_api/test_jobs.py::TestPatchJobs::test_can_set_updated_by_on_job_state_update -v
```

(Adjust class name to the actual enclosing class if different — find with grep for `test_can_update_assignee_updated_date_on_assignee_updates`.)

Expected: FAIL (KeyError / assertion on missing `updated_by`, or field null forever).

- [ ] **Step 3: Expose `updated_by` on `JobReadSerializer`**

In `JobReadSerializer`:

```python
    assignee = BasicUserSerializer(allow_null=True, read_only=True)
    updated_by = BasicUserSerializer(allow_null=True, read_only=True)
```

Add `"updated_by"` to `Meta.fields` next to `"updated_date"` / `"assignee_updated_date"`.

- [ ] **Step 4: Set `updated_by` in `JobWriteSerializer.update`**

Replace the end of `update` so the requesting user is stored on every real write-path update:

```python
    def update(self, instance: models.Job, validated_data: dict[str, Any]):
        stage = validated_data.get("stage", instance.stage)
        state = validated_data.get(
            "state", models.StateChoice.NEW if stage != instance.stage else instance.state
        )

        if "stage" in validated_data or "state" in validated_data:
            if stage == models.StageChoice.ANNOTATION:
                validated_data["status"] = models.StatusChoice.ANNOTATION
            elif stage == models.StageChoice.ACCEPTANCE and state == models.StateChoice.COMPLETED:
                validated_data["status"] = models.StatusChoice.COMPLETED
            else:
                validated_data["status"] = models.StatusChoice.VALIDATION

        if state != instance.state:
            validated_data["state"] = state

        if "assignee" in validated_data and (
            (assignee_id := validated_data.pop("assignee")) != instance.assignee_id
        ):
            instance.update_assignee(assignee_id)

        instance = super().update(instance, validated_data)

        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        if user is not None and getattr(user, "is_authenticated", False):
            instance.updated_by = user
            instance.save(update_fields=["updated_by"])

        return instance
```

- [ ] **Step 5: `select_related("updated_by")` in `JobViewSet.get_queryset`**

In `cvat/apps/engine/views.py` `JobViewSet.get_queryset`:

- list branch: change `queryset.select_related("assignee")` → `queryset.select_related("assignee", "updated_by")`
- retrieve/update branch: add `"updated_by"` to the existing `select_related("assignee", ...)` tuple

- [ ] **Step 6: Run test to verify it passes**

```bash
pytest tests/python/rest_api/test_jobs.py -k test_can_set_updated_by_on_job_state_update -v
```

Expected: PASS

Also sanity-check assignee update still works:

```bash
pytest tests/python/rest_api/test_jobs.py -k test_can_update_assignee_updated_date_on_assignee_updates -v
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add cvat/apps/engine/serializers.py cvat/apps/engine/views.py tests/python/rest_api/test_jobs.py
git commit -m "$(cat <<'EOF'
feat(engine): set and expose job updated_by on updates

EOF
)"
```

---

### Task 3: cvat-core Job mapping for `updatedBy`

**Files:**
- Modify: `cvat-core/src/server-response-types.ts` (`SerializedJob` ~146)
- Modify: `cvat-core/src/session.ts` (`Job` class `#data`, constructor defaults, `reinit`, getters; Task→Job construction ~1020)

**Interfaces:**
- Consumes: API `updated_by` nested user (same shape as `assignee`)
- Produces: `job.updatedBy: User | null` and keeps `job.updatedDate`

- [ ] **Step 1: Extend `SerializedJob`**

In `cvat-core/src/server-response-types.ts`:

```typescript
export interface SerializedJob {
    assignee: SerializedUser | null;
    updated_by?: SerializedUser | null;
    // ...existing fields unchanged...
    updated_date: string;
    created_date: string;
    // ...
}
```

- [ ] **Step 2: Map on `Job` in `session.ts`**

1. Add to `#data` type and defaults: `updated_by: User | null` (default `null`).
2. In `reinit`:

```typescript
        if (data.updated_by?.id !== this.#data.updated_by?.id) {
            if (data.updated_by) {
                this.#data.updated_by = new User(data.updated_by);
            } else if (data.updated_by === null) {
                this.#data.updated_by = null;
            }
        }
```

(Only clear when API explicitly sends `null`; if field omitted keep previous.)

3. Add getter:

```typescript
    public get updatedBy(): User | null {
        return this.#data.updated_by;
    }
```

4. When Task constructor builds nested `new Job({...})`, pass `updated_by: job.updated_by`.

- [ ] **Step 3: Typecheck / build core if used in-repo**

```bash
# from cvat-core if package scripts exist; otherwise rely on UI build later
npx tsc -p cvat-core/tsconfig.json --noEmit
```

Expected: no new errors related to `updated_by` / `updatedBy`.

- [ ] **Step 4: Commit**

```bash
git add cvat-core/src/server-response-types.ts cvat-core/src/session.ts
git commit -m "$(cat <<'EOF'
feat(core): map job updatedBy from API

EOF
)"
```

---

### Task 4: Show last updated at/by on Jobs page + task job list

**Files:**
- Modify: `cvat-ui/src/components/job-item/job-item.tsx` (~189–195)
- Modify: `cvat-ui/src/components/jobs-page/job-card.tsx`
- Modify: `cvat-ui/src/components/jobs-page/styles.scss` (optional spacing for new row)

**Interfaces:**
- Consumes: `job.updatedDate`, `job.updatedBy?.username`
- Produces: UI text `Updated {fromNow()} by {username}` with absolute datetime tooltip; omit `by …` when `updatedBy` is null

- [ ] **Step 1: Update task page `job-item.tsx`**

Replace the updated meta line with tooltip + optional by-clause:

```tsx
                    <div className='cvat-job-item-meta'>
                        <CVATTooltip title={updated.isValid() ? updated.format('YYYY-MM-DD HH:mm:ss Z') : ''}>
                            <Text type='secondary' className='cvat-job-item-updated'>
                                {`Updated ${updated.fromNow()}`}
                                {job.updatedBy?.username ? ` by ${job.updatedBy.username}` : ''}
                            </Text>
                        </CVATTooltip>
                        <Text type='secondary' className='cvat-job-item-created'>
                            {`Created ${formatDate(created)}`}
                        </Text>
                    </div>
```

`CVATTooltip` is already imported in this file.

- [ ] **Step 2: Update Jobs page `job-card.tsx`**

Add imports:

```tsx
import dayjs from 'dayjs';
import Text from 'antd/lib/typography/Text';
import CVATTooltip from 'components/common/cvat-tooltip';
```

Inside the card body (after assignee block), add:

```tsx
                <div className='cvat-job-card-updated'>
                    <span className='cvat-job-card-label'>Last updated</span>
                    <CVATTooltip
                        title={
                            job.updatedDate
                                ? dayjs(job.updatedDate).format('YYYY-MM-DD HH:mm:ss Z')
                                : ''
                        }
                    >
                        <span className='cvat-job-card-value'>
                            {job.updatedDate ? `Updated ${dayjs(job.updatedDate).fromNow()}` : '—'}
                            {job.updatedBy?.username ? ` by ${job.updatedBy.username}` : ''}
                        </span>
                    </CVATTooltip>
                </div>
```

- [ ] **Step 3: Style the new jobs-card row**

In `cvat-ui/src/components/jobs-page/styles.scss`, mirror assignee row spacing:

```scss
.cvat-job-card-updated {
    margin-top: $grid-unit-size;
}
```

(Use the same spacing token pattern already used by `.cvat-job-card-assignee` if different.)

- [ ] **Step 4: Manual UI check**

1. Rebuild / refresh UI.
2. Open a task → change a job state or stage → confirm row shows `Updated … by <you>`.
3. Open Jobs page → same job card shows Last updated with by-clause.
4. A never-updated-since-deploy job may omit `by` until first PATCH.

- [ ] **Step 5: Commit**

```bash
git add \
  cvat-ui/src/components/job-item/job-item.tsx \
  cvat-ui/src/components/jobs-page/job-card.tsx \
  cvat-ui/src/components/jobs-page/styles.scss
git commit -m "$(cat <<'EOF'
feat(ui): show job last updated at and by

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Add `updated_by` FK | Task 1 |
| Set on JobWriteSerializer updates (stage/state/assignee/etc.) | Task 2 |
| Skip touch-only bumps outside write serializer | Task 2 (only set in `update`) |
| Expose nested user on JobReadSerializer | Task 2 |
| Map in cvat-core | Task 3 |
| Show on Jobs page + task job list | Task 4 |
| Omit `by` when null | Task 4 |
| No last-opened / history / CSV | (non-goals; no tasks) |

## Placeholder / consistency review

- Field name: API/DB `updated_by`, core getter `updatedBy`, UI `job.updatedBy.username`.
- Timestamp remains `updated_date` / `updatedDate` only.
- Migration dependency must match the branch tip (`0106_add_interval_annotations` or newer).
