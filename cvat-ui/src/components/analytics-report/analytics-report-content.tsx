// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { Project, Task, Job } from 'cvat-core-wrapper';
import { CombinedState } from 'reducers';
import { TimePeriod } from '.';
import AnalyticsDashboard, { AnalyticsDashboardFilter } from './analytics-dashboard';

interface Props {
    resource?: Project | Task | Job | null;
    timePeriod: TimePeriod | null;
    filterOverrides?: AnalyticsDashboardFilter;
    showProjectLinks?: boolean;
}

function buildResourceFilter(
    resource: Project | Task | Job | null | undefined,
    timePeriod: TimePeriod | null,
    filterOverrides?: AnalyticsDashboardFilter,
): AnalyticsDashboardFilter {
    const filter: AnalyticsDashboardFilter = { ...(filterOverrides || {}) };

    if (timePeriod) {
        filter.from = timePeriod.startDate;
        filter.to = timePeriod.endDate;
    }

    if (resource) {
        if (resource instanceof Project) {
            filter.projectId = resource.id;
        } else if (resource instanceof Task) {
            filter.taskId = resource.id;
        } else if (resource instanceof Job) {
            filter.jobId = resource.id;
        }
    }

    return filter;
}

function AnalyticsReportContent(props: Readonly<Props>): JSX.Element {
    const {
        resource, timePeriod, filterOverrides, showProjectLinks,
    } = props;

    const filter = useMemo(
        () => buildResourceFilter(resource, timePeriod, filterOverrides),
        [
            resource,
            timePeriod?.startDate,
            timePeriod?.endDate,
            filterOverrides?.from,
            filterOverrides?.to,
            filterOverrides?.projectId,
            filterOverrides?.taskId,
            filterOverrides?.jobId,
            filterOverrides?.userId,
            filterOverrides?.orgId,
        ],
    );

    return (
        <AnalyticsDashboard
            filter={filter}
            showProjectLinks={showProjectLinks}
        />
    );
}

function AnalyticsReportContentWrap(props: Readonly<Props>): JSX.Element {
    const overrides = useSelector(
        (state: CombinedState) => state.plugins.overridableComponents.analyticsReportPage.content,
    );

    if (overrides.length) {
        const [Component] = overrides.slice(-1);
        return <Component {...props} />;
    }

    return <AnalyticsReportContent {...props} />;
}

export default React.memo(AnalyticsReportContentWrap);
