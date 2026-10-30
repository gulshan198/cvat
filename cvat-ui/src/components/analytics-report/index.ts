// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export interface TimePeriod {
    startDate: string;
    endDate: string;
}

export { default as AnalyticsDashboard } from './analytics-dashboard';
export { default as AnalyticsHubPage } from './analytics-hub-page';
export type { AnalyticsDashboardFilter } from './analytics-dashboard';
