# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import PurePath

import django_rq
from django.conf import settings
from django.db import transaction

from cvat.apps.engine import models
from cvat.apps.engine.cloud_provider import (
    SubdirectoryCloudStorage,
    db_storage_to_storage_instance,
)
from cvat.apps.engine.log import ServerLogManager

slogger = ServerLogManager(__name__)

_MAX_UPLOAD_THREADS = 8


def task_folder_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def is_mirroring_enabled() -> bool:
    return settings.GUARDEX_GCS_MIRROR_CLOUD_STORAGE_ID is not None


def get_mirror_path_prefix() -> str | None:
    cloud_storage_id = settings.GUARDEX_GCS_MIRROR_CLOUD_STORAGE_ID
    if cloud_storage_id is None:
        return None

    resource = (
        models.CloudStorage.objects.filter(pk=cloud_storage_id)
        .values_list("resource", flat=True)
        .first()
    )
    if resource is None:
        return None

    return f"{resource}/{settings.GUARDEX_GCS_MIRROR_PREFIX}"


def schedule_task_mirroring(db_task: models.Task) -> None:
    if not is_mirroring_enabled():
        return

    task_id = db_task.id

    def enqueue() -> None:
        queue = django_rq.get_queue(settings.CVAT_QUEUES.CLEANING.value)
        queue.enqueue(mirror_task_images_to_gcs, task_id)

    transaction.on_commit(enqueue)


def mirror_task_images_to_gcs(task_id: int) -> None:
    cloud_storage_id = settings.GUARDEX_GCS_MIRROR_CLOUD_STORAGE_ID
    if cloud_storage_id is None:
        return

    db_task = models.Task.objects.select_related("data").filter(pk=task_id).first()
    if not db_task or not db_task.data:
        slogger.glob.warning(f"GCS mirror: task #{task_id} or its data no longer exists")
        return

    db_data = db_task.data
    if db_data.storage != models.StorageChoice.LOCAL or db_data.local_storage_backing_cs_id:
        return

    slug = task_folder_slug(db_task.name) or f"task-{task_id}"

    try:
        db_cloud_storage = models.CloudStorage.objects.get(pk=cloud_storage_id)
    except models.CloudStorage.DoesNotExist:
        slogger.glob.warning(f"GCS mirror: cloud storage #{cloud_storage_id} does not exist")
        return

    # The storage is chosen by the server admin, not by the task creator
    storage = SubdirectoryCloudStorage(
        db_storage_to_storage_instance(db_cloud_storage, is_trusted=True),
        f"{settings.GUARDEX_GCS_MIRROR_PREFIX}/{slug}",
    )

    upload_dir = db_data.get_upload_dirname()
    rel_paths = db_data.get_all_media_rel_paths()

    def upload_one(rel_path: PurePath) -> bool:
        try:
            storage.upload_file(upload_dir / rel_path, rel_path.as_posix())
            return True
        except Exception:
            slogger.glob.exception(
                f"GCS mirror: failed to upload '{rel_path}' of task #{task_id} to {storage.name}"
            )
            return False

    with ThreadPoolExecutor(max_workers=min(_MAX_UPLOAD_THREADS, max(1, len(rel_paths)))) as pool:
        results = list(pool.map(upload_one, rel_paths))

    uploaded = sum(results)
    slogger.glob.info(
        f"GCS mirror: task #{task_id} -> {storage.name}: "
        f"{uploaded} uploaded, {len(results) - uploaded} failed"
    )
