# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from rest_framework import routers

from . import views

router = routers.DefaultRouter(trailing_slash=False)
router.register("events", views.EventsViewSet, basename="events")
router.register("analytics", views.AnalyticsViewSet, basename="analytics")

urlpatterns = router.urls
