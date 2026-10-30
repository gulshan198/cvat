# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import clickhouse_connect
from dateutil import parser
from django.conf import settings
from django.db.models import Count, Max, Min, Q
from rest_framework import serializers

from cvat.apps.engine.models import (
    Job,
    Label,
    LabeledImage,
    LabeledShape,
    LabeledTrack,
    StageChoice,
    StateChoice,
)
from cvat.apps.events.const import WORKING_TIME_SCOPE
from cvat.apps.events.utils import find_minimal_date_for_filter

CREATE_SCOPES = ("create:shapes", "create:tags", "create:tracks")
DELETE_SCOPES = ("delete:shapes", "delete:tags", "delete:tracks")
PAYLOAD_ARRAY_KEYS = ("shapes", "tags", "tracks")


def _parse_datetime(value: str | None, field_name: str) -> datetime | None:
    if not value:
        return None
    try:
        return parser.isoparse(value)
    except parser.ParserError as exc:
        raise serializers.ValidationError(
            f"Cannot parse {field_name!r} datetime parameter: {value}"
        ) from exc


def parse_summary_filters(query_params: dict[str, Any]) -> dict[str, Any]:
    resource_filters = ("org_id", "project_id", "task_id", "job_id", "user_id")
    filters = {key: query_params.get(key) for key in resource_filters}

    for key, value in list(filters.items()):
        if value in (None, ""):
            filters[key] = None
        else:
            try:
                filters[key] = int(value)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError(f"Invalid {key}: {value}") from exc

    from_dt = _parse_datetime(query_params.get("from"), "from")
    to_dt = _parse_datetime(query_params.get("to"), "to")

    if from_dt and to_dt and from_dt > to_dt:
        raise serializers.ValidationError("'from' must be before than 'to'")

    if not to_dt:
        to_dt = datetime.now(timezone.utc)
    if not from_dt:
        # Default to last 7 days when caller did not specify a start
        from_dt = to_dt - timedelta(days=7)
        # Prefer resource creation date if it is more recent than 7 days ago
        minimal = find_minimal_date_for_filter(
            job_id=filters["job_id"],
            task_id=filters["task_id"],
            project_id=filters["project_id"],
            org_id=filters["org_id"],
        )
        if minimal and minimal > from_dt:
            from_dt = minimal

    # If both ends fall on the same calendar second/day start (common for single-day
    # date pickers), expand `to` to end of that UTC day so the window is not empty.
    if from_dt and to_dt and from_dt.date() == to_dt.date() and to_dt <= from_dt + timedelta(minutes=1):
        to_dt = from_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    filters["from"] = from_dt
    filters["to"] = to_dt
    return filters


def _clickhouse_client():
    clickhouse_settings = settings.CLICKHOUSE["events"]
    return clickhouse_connect.get_client(
        host=clickhouse_settings["HOST"],
        database=clickhouse_settings["NAME"],
        port=clickhouse_settings["PORT"],
        username=clickhouse_settings["USER"],
        password=clickhouse_settings["PASSWORD"],
        tz_mode="schema",
    )


def _base_conditions(filters: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    conditions = ["source in ('server', 'client')", "scope != 'send:exception'"]
    parameters: dict[str, Any] = {
        "from": filters["from"],
        "to": filters["to"],
    }
    conditions.append("timestamp >= {from:DateTime64}")
    conditions.append("timestamp <= {to:DateTime64}")

    for param in ("org_id", "project_id", "task_id", "job_id", "user_id"):
        if filters.get(param) is not None:
            conditions.append(f"{param} = {{{param}:UInt64}}")
            parameters[param] = filters[param]

    return conditions, parameters


def _job_queryset(filters: dict[str, Any]):
    qs = Job.objects.select_related("segment", "segment__task", "assignee")
    if filters.get("job_id") is not None:
        qs = qs.filter(id=filters["job_id"])
    if filters.get("task_id") is not None:
        qs = qs.filter(segment__task_id=filters["task_id"])
    if filters.get("project_id") is not None:
        qs = qs.filter(segment__task__project_id=filters["project_id"])
    if filters.get("org_id") is not None:
        qs = qs.filter(
            Q(segment__task__organization_id=filters["org_id"])
            | Q(segment__task__project__organization_id=filters["org_id"])
        )
    if filters.get("user_id") is not None:
        qs = qs.filter(assignee_id=filters["user_id"])
    return qs


def _job_frame_count(job: Job) -> int:
    try:
        return job.segment.frame_count
    except Exception:
        return 0


def _label_names(label_ids: set[int]) -> dict[int, str]:
    if not label_ids:
        return {}
    return dict(Label.objects.filter(id__in=label_ids).values_list("id", "name"))


def _fetch_annotation_items(client, filters: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten create annotation events into per-object rows with day/frame/label/user."""
    conditions, parameters = _base_conditions(filters)
    scope_list = ", ".join(f"'{scope}'" for scope in CREATE_SCOPES)
    conditions.append(f"scope IN ({scope_list})")

    query = f"""
        SELECT
            toDate(timestamp) AS day,
            user_id,
            user_name,
            scope,
            payload
        FROM events
        WHERE {' AND '.join(conditions)}
        ORDER BY timestamp ASC
    """
    result = client.query(query, parameters=parameters)
    rows: list[dict[str, Any]] = []

    for day, user_id, user_name, scope, payload in result.result_rows:
        payload = payload or {}
        if isinstance(payload, str):
            import json

            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}

        array_key = "shapes"
        if scope.endswith(":tags"):
            array_key = "tags"
        elif scope.endswith(":tracks"):
            array_key = "tracks"

        items = payload.get(array_key) or []
        if not items and any(payload.get(key) for key in PAYLOAD_ARRAY_KEYS):
            # Fallback if scope/array mismatch
            for key in PAYLOAD_ARRAY_KEYS:
                if payload.get(key):
                    items = payload[key]
                    break

        day_str = day.isoformat() if hasattr(day, "isoformat") else str(day)

        if not items:
            # Legacy events without enriched payload: count as one anonymous object
            rows.append(
                {
                    "day": day_str,
                    "user_id": user_id,
                    "user_name": user_name or "",
                    "frame": None,
                    "label_id": None,
                    "legacy": True,
                }
            )
            continue

        for item in items:
            if not isinstance(item, dict):
                continue
            frame = item.get("frame")
            label_id = item.get("label_id")
            rows.append(
                {
                    "day": day_str,
                    "user_id": user_id,
                    "user_name": user_name or "",
                    "frame": int(frame) if frame is not None else None,
                    "label_id": int(label_id) if label_id is not None else None,
                    "legacy": frame is None and label_id is None,
                }
            )

    return rows


def _aggregate_annotated_images(items: list[dict[str, Any]]) -> tuple[list[dict], list[dict], bool]:
    by_day_frames: dict[str, set] = defaultdict(set)
    by_day_label_frames: dict[str, dict[int | None, set]] = defaultdict(lambda: defaultdict(set))
    by_day_legacy_count: dict[str, int] = defaultdict(int)
    by_user_frames: dict[tuple, set] = defaultdict(set)
    by_user_legacy: dict[tuple, int] = defaultdict(int)
    has_enriched = False

    for item in items:
        day = item["day"]
        user_key = (item["user_id"], item["user_name"])
        if item["frame"] is not None:
            has_enriched = True
            # Deduplicate images per job-less global view using (user, frame, label) loosely;
            # frame alone is enough for daily image count within a scoped resource.
            by_day_frames[day].add((item["user_id"], item["frame"]))
            by_day_label_frames[day][item["label_id"]].add((item["user_id"], item["frame"]))
            by_user_frames[user_key].add(item["frame"])
        else:
            by_day_legacy_count[day] += 1
            by_user_legacy[user_key] += 1

    all_days = sorted(set(by_day_frames) | set(by_day_legacy_count))
    label_ids = {
        label_id
        for day_map in by_day_label_frames.values()
        for label_id in day_map
        if label_id is not None
    }
    label_names = _label_names(label_ids)

    annotated_images_by_day = []
    for day in all_days:
        images = len(by_day_frames[day])
        # When only legacy events exist, report object counts as images approximation
        if images == 0 and by_day_legacy_count[day]:
            images = by_day_legacy_count[day]

        by_label = []
        for label_id, frames in by_day_label_frames[day].items():
            by_label.append(
                {
                    "label_id": label_id,
                    "name": label_names.get(label_id, "unknown") if label_id is not None else "unknown",
                    "images": len(frames),
                }
            )
        by_label.sort(key=lambda row: (-row["images"], row["name"] or ""))
        annotated_images_by_day.append(
            {
                "date": day,
                "images": images,
                "by_label": by_label,
            }
        )

    top_contributors = []
    user_keys = set(by_user_frames) | set(by_user_legacy)
    for user_id, user_name in user_keys:
        images = len(by_user_frames[(user_id, user_name)])
        if images == 0:
            images = by_user_legacy[(user_id, user_name)]
        top_contributors.append(
            {
                "user_id": user_id,
                "username": user_name or "",
                "images": images,
            }
        )
    top_contributors.sort(key=lambda row: (-row["images"], row["username"]))
    return annotated_images_by_day, top_contributors[:20], has_enriched


def _fetch_objects_by_day(client, filters: dict[str, Any]) -> list[dict[str, Any]]:
    conditions, parameters = _base_conditions(filters)
    scopes = ", ".join(f"'{scope}'" for scope in CREATE_SCOPES + DELETE_SCOPES)
    conditions.append(f"scope IN ({scopes})")

    query = f"""
        SELECT
            toDate(timestamp) AS day,
            scope,
            sum(count) AS total
        FROM events
        WHERE {' AND '.join(conditions)}
        GROUP BY day, scope
        ORDER BY day ASC
    """
    result = client.query(query, parameters=parameters)
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {"created": 0, "deleted": 0})
    for day, scope, total in result.result_rows:
        day_str = day.isoformat() if hasattr(day, "isoformat") else str(day)
        total = int(total or 0)
        if scope.startswith("create:"):
            by_day[day_str]["created"] += total
        elif scope.startswith("delete:"):
            by_day[day_str]["deleted"] += total

    return [
        {"date": day, "created": values["created"], "deleted": values["deleted"]}
        for day, values in sorted(by_day.items())
    ]


def _fetch_working_time_by_user(client, filters: dict[str, Any]) -> list[dict[str, Any]]:
    conditions, parameters = _base_conditions(filters)
    conditions.append(f"scope = '{WORKING_TIME_SCOPE}'")

    query = f"""
        SELECT
            user_id,
            any(user_name) AS user_name,
            sum(
                if(
                    JSONHas(payload, 'working_time'),
                    JSONExtractInt(payload, 'working_time'),
                    0
                )
            ) AS working_time_ms
        FROM events
        WHERE {' AND '.join(conditions)}
        GROUP BY user_id
        ORDER BY working_time_ms DESC
    """
    try:
        result = client.query(query, parameters=parameters)
    except Exception:
        # Older payloads may not be valid JSON for JSONHas; fall back to scanning in Python
        query = f"""
            SELECT user_id, user_name, payload
            FROM events
            WHERE {' AND '.join(conditions)}
        """
        result = client.query(query, parameters=parameters)
        totals: dict[int, dict[str, Any]] = {}
        import json

        for user_id, user_name, payload in result.result_rows:
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except json.JSONDecodeError:
                    payload = {}
            ms = int((payload or {}).get("working_time") or 0)
            entry = totals.setdefault(
                user_id, {"user_id": user_id, "username": user_name or "", "ms": 0}
            )
            entry["ms"] += ms
            if user_name:
                entry["username"] = user_name
        return sorted(totals.values(), key=lambda row: -row["ms"])

    return [
        {
            "user_id": user_id,
            "username": user_name or "",
            "ms": int(working_time_ms or 0),
        }
        for user_id, user_name, working_time_ms in result.result_rows
    ]


def _fetch_done_job_ids(client, filters: dict[str, Any]) -> set[int]:
    conditions, parameters = _base_conditions(filters)
    conditions.append("scope = 'update:job'")
    conditions.append(
        "((obj_name = 'stage' AND obj_val = 'acceptance') OR "
        "(obj_name = 'state' AND obj_val = 'completed'))"
    )

    query = f"""
        SELECT DISTINCT job_id
        FROM events
        WHERE {' AND '.join(conditions)} AND job_id IS NOT NULL
    """
    result = client.query(query, parameters=parameters)
    return {int(job_id) for (job_id,) in result.result_rows if job_id is not None}


def _assignee_workload(filters: dict[str, Any], done_job_ids: set[int]) -> list[dict[str, Any]]:
    qs = _job_queryset(filters).filter(assignee_id__isnull=False)

    assigned_jobs = qs.filter(
        assignee_updated_date__gte=filters["from"],
        assignee_updated_date__lte=filters["to"],
    )

    workload: dict[int, dict[str, Any]] = {}

    def ensure(user_id: int, username: str) -> dict[str, Any]:
        return workload.setdefault(
            user_id,
            {
                "user_id": user_id,
                "username": username,
                "images_assigned": 0,
                "images_done": 0,
                "jobs_assigned": 0,
                "jobs_done": 0,
            },
        )

    for job in assigned_jobs:
        username = job.assignee.username if job.assignee else ""
        entry = ensure(job.assignee_id, username)
        frames = _job_frame_count(job)
        entry["images_assigned"] += frames
        entry["jobs_assigned"] += 1

    if done_job_ids:
        done_jobs = qs.filter(id__in=done_job_ids)
        for job in done_jobs:
            if not job.assignee_id:
                continue
            username = job.assignee.username if job.assignee else ""
            entry = ensure(job.assignee_id, username)
            frames = _job_frame_count(job)
            entry["images_done"] += frames
            entry["jobs_done"] += 1

    return sorted(
        workload.values(),
        key=lambda row: (-row["images_assigned"], -row["images_done"], row["username"]),
    )


def _pipeline_snapshot(filters: dict[str, Any]) -> dict[str, int]:
    qs = _job_queryset(filters)
    stage_counts = {
        row["stage"]: row["count"]
        for row in qs.values("stage").annotate(count=Count("id"))
    }
    completed = qs.filter(state=StateChoice.COMPLETED).count()
    return {
        "annotation": stage_counts.get(StageChoice.ANNOTATION, 0),
        "validation": stage_counts.get(StageChoice.VALIDATION, 0),
        "acceptance": stage_counts.get(StageChoice.ACCEPTANCE, 0),
        "completed": completed,
    }


def _annotation_inventory(filters: dict[str, Any]) -> dict[str, Any]:
    """Current annotation inventory (Premium Annotations tab), not time-filtered."""
    job_ids = list(_job_queryset(filters).values_list("id", flat=True))
    if not job_ids:
        return {
            "detections": [],
            "tracking": [],
            "totals": {"shapes": 0, "tags": 0, "tracks": 0, "images": 0},
        }

    detections: dict[int, dict[str, Any]] = {}

    def ensure_detection(label_id: int, label_name: str) -> dict[str, Any]:
        return detections.setdefault(
            label_id,
            {
                "label_id": label_id,
                "label_name": label_name or "unknown",
                "by_type": {},
                "total_shapes": 0,
                "tags": 0,
            },
        )

    shape_rows = (
        LabeledShape.objects.filter(job_id__in=job_ids, parent__isnull=True)
        .values("label_id", "label__name", "type")
        .annotate(count=Count("id"))
    )
    for row in shape_rows:
        entry = ensure_detection(row["label_id"], row["label__name"] or "")
        shape_type = row["type"] or "unknown"
        entry["by_type"][shape_type] = entry["by_type"].get(shape_type, 0) + int(row["count"])
        entry["total_shapes"] += int(row["count"])

    tag_rows = (
        LabeledImage.objects.filter(job_id__in=job_ids)
        .values("label_id", "label__name")
        .annotate(count=Count("id"))
    )
    for row in tag_rows:
        entry = ensure_detection(row["label_id"], row["label__name"] or "")
        entry["tags"] += int(row["count"])

    tracking: dict[int, dict[str, Any]] = {}

    def ensure_tracking(label_id: int, label_name: str) -> dict[str, Any]:
        return tracking.setdefault(
            label_id,
            {
                "label_id": label_id,
                "label_name": label_name or "unknown",
                "by_type": {},
                "keyframes": 0,
                "interpolated": 0,
                "tracks": 0,
                "total_objects": 0,
            },
        )

    track_qs = LabeledTrack.objects.filter(job_id__in=job_ids, parent__isnull=True).annotate(
        keyframe_count=Count("shapes"),
        frame_min=Min("shapes__frame"),
        frame_max=Max("shapes__frame"),
    )
    for track in track_qs.select_related("label"):
        entry = ensure_tracking(track.label_id, track.label.name if track.label else "")
        entry["tracks"] += 1
        keyframes = int(track.keyframe_count or 0)
        entry["keyframes"] += keyframes
        if track.frame_min is not None and track.frame_max is not None:
            span = int(track.frame_max) - int(track.frame_min) + 1
            entry["interpolated"] += max(0, span - keyframes)

    # Shape types used on tracked keyframes
    tracked_type_rows = (
        LabeledTrack.objects.filter(job_id__in=job_ids, parent__isnull=True)
        .values("label_id", "label__name", "shapes__type")
        .annotate(count=Count("shapes__id"))
    )
    for row in tracked_type_rows:
        if not row["shapes__type"]:
            continue
        entry = ensure_tracking(row["label_id"], row["label__name"] or "")
        shape_type = row["shapes__type"]
        entry["by_type"][shape_type] = entry["by_type"].get(shape_type, 0) + int(row["count"] or 0)

    for entry in tracking.values():
        entry["total_objects"] = entry["keyframes"] + entry["interpolated"]

    images_total = 0
    for job in _job_queryset(filters):
        images_total += _job_frame_count(job)

    detections_list = sorted(
        detections.values(),
        key=lambda row: (-(row["total_shapes"] + row["tags"]), row["label_name"]),
    )
    tracking_list = sorted(
        tracking.values(),
        key=lambda row: (-row["total_objects"], row["label_name"]),
    )

    return {
        "detections": detections_list,
        "tracking": tracking_list,
        "totals": {
            "shapes": sum(row["total_shapes"] for row in detections_list),
            "tags": sum(row["tags"] for row in detections_list),
            "tracks": sum(row["tracks"] for row in tracking_list),
            "images": images_total,
        },
    }


def build_analytics_summary(query_params: dict[str, Any]) -> dict[str, Any]:
    filters = parse_summary_filters(query_params)

    try:
        client = _clickhouse_client()
    except Exception as exc:
        raise serializers.ValidationError(
            "Analytics database is unavailable. "
            "Ensure ClickHouse is running and configured. "
            f"Details: {exc}"
        ) from exc

    with client:
        try:
            annotation_items = _fetch_annotation_items(client, filters)
            objects_by_day = _fetch_objects_by_day(client, filters)
            working_time_by_user = _fetch_working_time_by_user(client, filters)
            done_job_ids = _fetch_done_job_ids(client, filters)
        except Exception as exc:
            raise serializers.ValidationError(
                f"Failed to query analytics events. Details: {exc}"
            ) from exc

    annotated_images_by_day, top_contributors, has_enriched = _aggregate_annotated_images(
        annotation_items
    )
    assignee_workload = _assignee_workload(filters, done_job_ids)
    pipeline = _pipeline_snapshot(filters)
    inventory = _annotation_inventory(filters)

    total_created = sum(row["created"] for row in objects_by_day)
    total_deleted = sum(row["deleted"] for row in objects_by_day)
    objects_diff = total_created - total_deleted
    total_working_ms = sum(row["ms"] for row in working_time_by_user)
    working_hours = total_working_ms / 3600000 if total_working_ms else 0
    avg_annotation_speed = (objects_diff / working_hours) if working_hours > 0 else 0.0

    return {
        "period": {
            "from": filters["from"].isoformat(),
            "to": filters["to"].isoformat(),
        },
        "has_frame_label_data": has_enriched,
        "objects_diff": objects_diff,
        "total_working_time_ms": total_working_ms,
        "avg_annotation_speed": round(avg_annotation_speed, 2),
        "annotated_images_by_day": annotated_images_by_day,
        "assignee_workload": assignee_workload,
        "objects_by_day": objects_by_day,
        "working_time_by_user": working_time_by_user,
        "pipeline": pipeline,
        "top_contributors": top_contributors,
        "annotation_inventory": inventory,
    }
