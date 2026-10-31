// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Row, Col } from 'antd/lib/grid';
import Alert from 'antd/lib/alert';
import Card from 'antd/lib/card';
import Empty from 'antd/lib/empty';
import Table from 'antd/lib/table';
import Tabs from 'antd/lib/tabs';
import Text from 'antd/lib/typography/Text';
import Title from 'antd/lib/typography/Title';
import { QuestionCircleOutlined } from '@ant-design/icons';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    ArcElement,
    Tooltip,
    Legend,
    ChartOptions,
    TooltipItem,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

import { getCore } from 'cvat-core-wrapper';
import type { SerializedAnalyticsSummary } from 'cvat-core/src/server-response-types';
import CVATLoadingSpinner from 'components/common/loading-spinner';
import CVATTooltip from 'components/common/cvat-tooltip';
import { formatPeriodIst } from './date-range';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const LABEL_COLORS = [
    'rgba(24, 144, 255, 0.75)',
    'rgba(82, 196, 26, 0.75)',
    'rgba(250, 173, 20, 0.75)',
    'rgba(245, 34, 45, 0.75)',
    'rgba(114, 46, 209, 0.75)',
    'rgba(19, 194, 194, 0.75)',
    'rgba(235, 47, 150, 0.75)',
    'rgba(47, 84, 235, 0.75)',
];

const core = getCore();

export interface AnalyticsDashboardFilter {
    from?: string;
    to?: string;
    projectId?: number;
    taskId?: number;
    jobId?: number;
    userId?: number;
    orgId?: number;
}

interface Props {
    filter: AnalyticsDashboardFilter;
    showProjectLinks?: boolean;
}

interface SectionProps {
    title: string;
    meaning: string;
    children: React.ReactNode;
    extra?: React.ReactNode;
}

interface KpiProps {
    label: string;
    value: string | number;
    hint: string;
    suffix?: string;
}

function formatHours(ms: number): string {
    return `${(ms / 3600000).toFixed(2)}h`;
}

function HelpIcon(props: Readonly<{ text: string }>): JSX.Element {
    const { text } = props;
    return (
        <CVATTooltip title={text}>
            <QuestionCircleOutlined className='cvat-analytics-help-icon' />
        </CVATTooltip>
    );
}

function KpiCard(props: Readonly<KpiProps>): JSX.Element {
    const {
        label, value, hint, suffix,
    } = props;
    return (
        <div className='cvat-analytics-kpi'>
            <div className='cvat-analytics-kpi-top'>
                <span className='cvat-analytics-kpi-label'>{label}</span>
                <HelpIcon text={hint} />
            </div>
            <div className='cvat-analytics-kpi-value'>
                {value}
                {suffix ? <span className='cvat-analytics-kpi-suffix'>{suffix}</span> : null}
            </div>
        </div>
    );
}

function ChartSection(props: Readonly<SectionProps>): JSX.Element {
    const {
        title, meaning, children, extra,
    } = props;
    return (
        <Card
            size='small'
            className='cvat-analytics-chart-card'
            title={(
                <div className='cvat-analytics-section-title'>
                    <span className='cvat-analytics-section-title-left'>
                        <Text strong>{title}</Text>
                        <HelpIcon text={meaning} />
                    </span>
                    {extra}
                </div>
            )}
        >
            {children}
        </Card>
    );
}

function AnalyticsDashboard(props: Readonly<Props>): JSX.Element {
    const { filter, showProjectLinks = false } = props;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<SerializedAnalyticsSummary | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const cleanedFilter: AnalyticsDashboardFilter = {};
        (Object.keys(filter) as (keyof AnalyticsDashboardFilter)[]).forEach((key) => {
            const value = filter[key];
            if (value !== undefined && value !== null && value !== '') {
                (cleanedFilter as Record<string, string | number>)[key] = value;
            }
        });

        core.analytics.summary(cleanedFilter)
            .then((data: SerializedAnalyticsSummary) => {
                if (!cancelled) {
                    setSummary(data);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : 'Failed to load analytics';
                    setError(message);
                    setSummary(null);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        filter.from,
        filter.to,
        filter.projectId,
        filter.taskId,
        filter.jobId,
        filter.userId,
        filter.orgId,
    ]);

    const annotatedChart = useMemo(() => {
        if (!summary) {
            return null;
        }
        const labels = summary.annotated_images_by_day.map((row) => row.date);
        const values = summary.annotated_images_by_day.map((row) => row.images);
        return {
            data: {
                labels,
                datasets: [{
                    label: 'Frames with new annotations',
                    data: values,
                    backgroundColor: 'rgba(24, 144, 255, 0.65)',
                    borderColor: 'rgba(24, 144, 255, 1)',
                    borderWidth: 1,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterBody(items: TooltipItem<'bar'>[]) {
                                const index = items[0]?.dataIndex;
                                if (index === undefined) {
                                    return [];
                                }
                                const day = summary.annotated_images_by_day[index];
                                if (!day?.by_label?.length) {
                                    return ['No per-label breakdown for this day'];
                                }
                                return [
                                    'Frames touched by label:',
                                    ...day.by_label.map(
                                        (label) => `  ${label.name}: ${label.images}`,
                                    ),
                                ];
                            },
                        },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: { display: true, text: 'Image / frame count' },
                    },
                },
            } as ChartOptions<'bar'>,
        };
    }, [summary]);

    const assigneeChart = useMemo(() => {
        if (!summary) {
            return null;
        }

        // Merge assignment volume with annotated frames per user.
        // "Done" for us = annotated (not job acceptance/completed).
        const byUser = new Map<number, {
            user_id: number;
            username: string;
            assigned: number;
            annotated: number;
        }>();

        summary.assignee_workload.forEach((row) => {
            byUser.set(row.user_id, {
                user_id: row.user_id,
                username: row.username || `user#${row.user_id}`,
                assigned: row.images_assigned,
                annotated: 0,
            });
        });
        summary.top_contributors.forEach((row) => {
            const existing = byUser.get(row.user_id);
            if (existing) {
                existing.annotated = row.images;
                if (row.username) {
                    existing.username = row.username;
                }
            } else {
                byUser.set(row.user_id, {
                    user_id: row.user_id,
                    username: row.username || `user#${row.user_id}`,
                    assigned: 0,
                    annotated: row.images,
                });
            }
        });

        const rows = [...byUser.values()].sort(
            (a, b) => (b.annotated + b.assigned) - (a.annotated + a.assigned),
        );
        if (!rows.length) {
            return null;
        }

        return {
            data: {
                labels: rows.map((row) => row.username),
                datasets: [
                    {
                        label: 'Images assigned (job size)',
                        data: rows.map((row) => row.assigned),
                        backgroundColor: 'rgba(250, 173, 20, 0.65)',
                    },
                    {
                        label: 'Images annotated (done)',
                        data: rows.map((row) => row.annotated),
                        backgroundColor: 'rgba(82, 196, 26, 0.65)',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' as const } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: { display: true, text: 'Image / frame count' },
                    },
                },
            } as ChartOptions<'bar'>,
        };
    }, [summary]);

    const objectsChart = useMemo(() => {
        if (!summary) {
            return null;
        }
        return {
            data: {
                labels: summary.objects_by_day.map((row) => row.date),
                datasets: [
                    {
                        label: 'Shapes/tags/tracks created',
                        data: summary.objects_by_day.map((row) => row.created),
                        backgroundColor: 'rgba(24, 144, 255, 0.65)',
                    },
                    {
                        label: 'Shapes/tags/tracks deleted',
                        data: summary.objects_by_day.map((row) => row.deleted),
                        backgroundColor: 'rgba(255, 77, 79, 0.65)',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' as const } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: { display: true, text: 'Object count' },
                    },
                },
            } as ChartOptions<'bar'>,
        };
    }, [summary]);

    const workingTimeChart = useMemo(() => {
        if (!summary) {
            return null;
        }
        return {
            data: {
                labels: summary.working_time_by_user.map(
                    (row) => row.username || `user#${row.user_id}`,
                ),
                datasets: [{
                    label: 'Active annotation time (hours)',
                    data: summary.working_time_by_user.map((row) => Number((row.ms / 3600000).toFixed(2))),
                    backgroundColor: 'rgba(114, 46, 209, 0.65)',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Hours' },
                    },
                },
            } as ChartOptions<'bar'>,
        };
    }, [summary]);

    const annotationSpeedChart = useMemo(() => {
        if (!summary) {
            return null;
        }
        // Premium "annotation speed" chart: net objects (created − deleted) per day.
        const labels = summary.objects_by_day.map((row) => row.date);
        const values = summary.objects_by_day.map((row) => row.created - row.deleted);
        if (!labels.length) {
            return null;
        }
        return {
            data: {
                labels,
                datasets: [{
                    label: 'Net objects (created − deleted)',
                    data: values,
                    backgroundColor: values.map((value) => (
                        value >= 0 ? 'rgba(82, 196, 26, 0.65)' : 'rgba(255, 77, 79, 0.65)'
                    )),
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        ticks: { precision: 0 },
                        title: { display: true, text: 'Net objects / day' },
                    },
                },
            } as ChartOptions<'bar'>,
        };
    }, [summary]);

    const labelDistributionChart = useMemo(() => {
        if (!summary) {
            return null;
        }
        const totals = new Map<string, number>();
        summary.annotated_images_by_day.forEach((day) => {
            day.by_label?.forEach((label) => {
                const name = label.name || 'unknown';
                totals.set(name, (totals.get(name) || 0) + label.images);
            });
        });
        const rows = [...totals.entries()]
            .map(([name, images]) => ({ name, images }))
            .sort((a, b) => b.images - a.images)
            .slice(0, 12);
        if (!rows.length) {
            return null;
        }
        return {
            data: {
                labels: rows.map((row) => row.name),
                datasets: [{
                    data: rows.map((row) => row.images),
                    backgroundColor: rows.map((_, index) => LABEL_COLORS[index % LABEL_COLORS.length]),
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' as const },
                },
            } as ChartOptions<'doughnut'>,
        };
    }, [summary]);

    if (loading) {
        return <CVATLoadingSpinner />;
    }

    if (error) {
        return (
            <Alert
                className='cvat-analytics-error'
                type='error'
                showIcon
                message='Could not load analytics'
                description={error}
            />
        );
    }

    if (!summary) {
        return <Empty description='No analytics data' />;
    }

    const totalAnnotated = summary.annotated_images_by_day.reduce((acc, row) => acc + row.images, 0);
    const totalAssigned = summary.assignee_workload.reduce((acc, row) => acc + row.images_assigned, 0);
    const totalWorkingMs = summary.total_working_time_ms ??
        summary.working_time_by_user.reduce((acc, row) => acc + row.ms, 0);
    const totalCreated = summary.objects_by_day.reduce((acc, row) => acc + row.created, 0);
    const totalDeleted = summary.objects_by_day.reduce((acc, row) => acc + row.deleted, 0);
    const objectsDiff = summary.objects_diff ?? (totalCreated - totalDeleted);
    const avgSpeed = summary.avg_annotation_speed ?? (
        totalWorkingMs > 0 ? Number((objectsDiff / (totalWorkingMs / 3600000)).toFixed(2)) : 0
    );
    const inventory = summary.annotation_inventory;
    const hasAnySeries = totalAnnotated > 0 ||
        totalAssigned > 0 ||
        totalCreated > 0 ||
        totalDeleted > 0 ||
        totalWorkingMs > 0;

    const periodLabel = summary.period?.from && summary.period?.to ?
        formatPeriodIst(summary.period.from, summary.period.to) :
        'selected period';

    const detectionTypeKeys = Array.from(new Set(
        (inventory?.detections || []).flatMap((row) => Object.keys(row.by_type || {})),
    )).sort();
    const trackingTypeKeys = Array.from(new Set(
        (inventory?.tracking || []).flatMap((row) => Object.keys(row.by_type || {})),
    )).sort();

    const inventoryEmpty = !inventory || (
        (inventory.totals.shapes ?? 0) === 0 &&
        (inventory.totals.tags ?? 0) === 0 &&
        (inventory.totals.tracks ?? 0) === 0
    );
    const needsResourceScope = showProjectLinks &&
        filter.projectId == null &&
        filter.taskId == null &&
        filter.jobId == null;

    return (
        <div className='cvat-analytics-dashboard'>
            <div className='cvat-analytics-period-bar'>
                <Text type='secondary'>
                    Showing
                    {' '}
                    <Text strong>{periodLabel}</Text>
                    {' · '}
                    days are IST (India Standard Time)
                </Text>
            </div>

            {!summary.has_frame_label_data && (
                <Alert
                    className='cvat-analytics-legacy-note'
                    type='warning'
                    showIcon
                    message='Limited label detail on older events'
                    description='Older events may lack frame/label fields. Hover chart bars for labels on new annotations.'
                />
            )}

            <Tabs
                className='cvat-analytics-tabs'
                defaultActiveKey='summary'
                items={[
                    {
                        key: 'summary',
                        label: 'Summary',
                        children: (
                            <>
                                <div className='cvat-analytics-kpi-grid'>
                                    <KpiCard
                                        label='Objects diff'
                                        value={objectsDiff.toLocaleString()}
                                        hint='Created minus deleted objects in this period'
                                    />
                                    <KpiCard
                                        label='Working time'
                                        value={formatHours(totalWorkingMs)}
                                        hint='Active time in the annotation UI'
                                    />
                                    <KpiCard
                                        label='Annotation speed'
                                        value={avgSpeed}
                                        suffix='/h'
                                        hint='Net objects per working hour'
                                    />
                                    <KpiCard
                                        label='Annotated images'
                                        value={totalAnnotated.toLocaleString()}
                                        hint='Frames that received new annotations (= done)'
                                    />
                                    <KpiCard
                                        label='Images assigned'
                                        value={totalAssigned.toLocaleString()}
                                        hint='Frames in jobs newly assigned in this period'
                                    />
                                    <KpiCard
                                        label='Created / deleted'
                                        value={`${totalCreated.toLocaleString()} / ${totalDeleted.toLocaleString()}`}
                                        hint='Raw object create vs delete counts'
                                    />
                                </div>

                                {!hasAnySeries ? (
                                    <Empty
                                        description={(
                                            <span>
                                                No activity in this period.
                                                {' '}
                                                Try a wider date range (e.g. last 7 days), or annotate/save a job so events are recorded.
                                            </span>
                                        )}
                                    />
                                ) : (
                                    <>
                                        <Row gutter={[16, 16]}>
                                            <Col xs={24} lg={16}>
                                                <ChartSection
                                                    title='Annotated images by day'
                                                    meaning={
                                                        'Distinct images/frames with new annotations each day. '
                                                        + 'Hover a bar for label breakdown.'
                                                    }
                                                >
                                                    <div className='cvat-analytics-chart'>
                                                        {annotatedChart && totalAnnotated > 0 ? (
                                                            <Bar data={annotatedChart.data} options={annotatedChart.options} />
                                                        ) : (
                                                            <Empty
                                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                                description='No annotation-create events in this period'
                                                            />
                                                        )}
                                                    </div>
                                                </ChartSection>
                                            </Col>
                                            <Col xs={24} lg={8}>
                                                <ChartSection
                                                    title='Label distribution'
                                                    meaning={
                                                        'Share of annotated frames by label in this period '
                                                        + '(Premium-style label diagram).'
                                                    }
                                                >
                                                    <div className='cvat-analytics-chart'>
                                                        {labelDistributionChart ? (
                                                            <Doughnut
                                                                data={labelDistributionChart.data}
                                                                options={labelDistributionChart.options}
                                                            />
                                                        ) : (
                                                            <Empty
                                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                                description='No label breakdown yet'
                                                            />
                                                        )}
                                                    </div>
                                                </ChartSection>
                                            </Col>
                                        </Row>

                                        <Row gutter={[16, 16]}>
                                            <Col xs={24} lg={12}>
                                                <ChartSection
                                                    title='Objects created vs deleted'
                                                    meaning={
                                                        'Premium object statistics: shapes/tags/tracks created vs deleted each day.'
                                                    }
                                                >
                                                    <div className='cvat-analytics-chart'>
                                                        {objectsChart && summary.objects_by_day.length ? (
                                                            <Bar data={objectsChart.data} options={objectsChart.options} />
                                                        ) : (
                                                            <Empty
                                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                                description='No create/delete object events'
                                                            />
                                                        )}
                                                    </div>
                                                </ChartSection>
                                            </Col>
                                            <Col xs={24} lg={12}>
                                                <ChartSection
                                                    title='Annotation speed by day'
                                                    meaning='Net objects (created − deleted) per day.'
                                                >
                                                    <div className='cvat-analytics-chart'>
                                                        {annotationSpeedChart ? (
                                                            <Bar
                                                                data={annotationSpeedChart.data}
                                                                options={annotationSpeedChart.options}
                                                            />
                                                        ) : (
                                                            <Empty
                                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                                description='No object activity'
                                                            />
                                                        )}
                                                    </div>
                                                </ChartSection>
                                            </Col>
                                        </Row>

                                        <Row gutter={[16, 16]}>
                                            <Col xs={24} lg={12}>
                                                <ChartSection
                                                    title='Assignee: assigned vs annotated'
                                                    meaning={
                                                        'Per person: yellow = frames assigned; green = frames annotated (done).'
                                                    }
                                                >
                                                    <div className='cvat-analytics-chart'>
                                                        {assigneeChart ? (
                                                            <Bar data={assigneeChart.data} options={assigneeChart.options} />
                                                        ) : (
                                                            <Empty
                                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                                description='No assignment or annotation activity'
                                                            />
                                                        )}
                                                    </div>
                                                </ChartSection>
                                            </Col>
                                            <Col xs={24} lg={12}>
                                                <ChartSection
                                                    title='Working time by user'
                                                    meaning='Active annotation UI time per user (Premium working-time metric).'
                                                >
                                                    <div className='cvat-analytics-chart'>
                                                        {workingTimeChart && summary.working_time_by_user.length ? (
                                                            <Bar
                                                                data={workingTimeChart.data}
                                                                options={workingTimeChart.options}
                                                            />
                                                        ) : (
                                                            <Empty
                                                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                                                description='No working-time events'
                                                            />
                                                        )}
                                                    </div>
                                                </ChartSection>
                                            </Col>
                                        </Row>

                                        <Row gutter={[16, 16]}>
                                            <Col span={24}>
                                                <ChartSection
                                                    title='Top contributors'
                                                    meaning='Users ranked by annotated images in the period.'
                                                >
                                                    <Table
                                                        size='small'
                                                        rowKey={(row) => String(row.user_id)}
                                                        pagination={false}
                                                        locale={{ emptyText: 'No contributors in this period' }}
                                                        dataSource={summary.top_contributors}
                                                        columns={[
                                                            {
                                                                title: 'User',
                                                                dataIndex: 'username',
                                                                key: 'username',
                                                                render: (username: string, row) => (
                                                                    username || `user#${row.user_id}`
                                                                ),
                                                            },
                                                            {
                                                                title: 'Annotated images',
                                                                dataIndex: 'images',
                                                                key: 'images',
                                                            },
                                                        ]}
                                                    />
                                                </ChartSection>
                                            </Col>
                                        </Row>
                                    </>
                                )}
                            </>
                        ),
                    },
                    {
                        key: 'annotations',
                        label: 'Annotations',
                        children: (
                            <>
                                <Text type='secondary' className='cvat-analytics-tab-note'>
                                    Live inventory of shapes / tags / tracks right now (not limited by the date range).
                                    Hover
                                    {' '}
                                    <QuestionCircleOutlined />
                                    {' '}
                                    on Summary charts for period metrics.
                                </Text>
                                {needsResourceScope && inventoryEmpty ? (
                                    <Empty
                                        description={(
                                            <span>
                                                Select a project in the filters above, or open
                                                {' '}
                                                <Link to='/projects'>a project → Actions → View analytics</Link>
                                                {' '}
                                                to load annotation inventory.
                                            </span>
                                        )}
                                    />
                                ) : (
                                    <>
                                        <div className='cvat-analytics-kpi-grid cvat-analytics-kpi-grid-4'>
                                            <KpiCard
                                                label='Shapes'
                                                value={(inventory?.totals.shapes ?? 0).toLocaleString()}
                                                hint='Current shape annotations in scope'
                                            />
                                            <KpiCard
                                                label='Tags'
                                                value={(inventory?.totals.tags ?? 0).toLocaleString()}
                                                hint='Current image tags in scope'
                                            />
                                            <KpiCard
                                                label='Tracks'
                                                value={(inventory?.totals.tracks ?? 0).toLocaleString()}
                                                hint='Current tracks in scope'
                                            />
                                            <KpiCard
                                                label='Images'
                                                value={(inventory?.totals.images ?? 0).toLocaleString()}
                                                hint='Frames in jobs in scope'
                                            />
                                        </div>

                                        <Title level={5} className='cvat-analytics-block-title'>Detections</Title>
                                        <Table
                                            size='small'
                                            className='cvat-analytics-inventory-table'
                                            rowKey={(row) => `det-${row.label_id}`}
                                            pagination={{ pageSize: 20 }}
                                            locale={{ emptyText: 'No shapes or tags in this scope' }}
                                            dataSource={inventory?.detections || []}
                                            columns={[
                                                { title: 'Label', dataIndex: 'label_name', key: 'label_name' },
                                                { title: 'ID', dataIndex: 'label_id', key: 'label_id', width: 80 },
                                                ...detectionTypeKeys.map((type) => ({
                                                    title: type,
                                                    key: `det-type-${type}`,
                                                    render: (_: unknown, row: { by_type: Record<string, number> }) => (
                                                        row.by_type?.[type] || 0
                                                    ),
                                                })),
                                                { title: 'Tags', dataIndex: 'tags', key: 'tags', width: 80 },
                                                { title: 'Total', dataIndex: 'total_shapes', key: 'total_shapes', width: 90 },
                                            ]}
                                        />

                                        <Title level={5} className='cvat-analytics-block-title'>Tracking</Title>
                                        <Table
                                            size='small'
                                            className='cvat-analytics-inventory-table'
                                            rowKey={(row) => `trk-${row.label_id}`}
                                            pagination={{ pageSize: 20 }}
                                            locale={{ emptyText: 'No tracks in this scope' }}
                                            dataSource={inventory?.tracking || []}
                                            columns={[
                                                { title: 'Label', dataIndex: 'label_name', key: 'label_name' },
                                                { title: 'ID', dataIndex: 'label_id', key: 'label_id', width: 80 },
                                                ...trackingTypeKeys.map((type) => ({
                                                    title: type,
                                                    key: `trk-type-${type}`,
                                                    render: (_: unknown, row: { by_type: Record<string, number> }) => (
                                                        row.by_type?.[type] || 0
                                                    ),
                                                })),
                                                { title: 'Keyframes', dataIndex: 'keyframes', key: 'keyframes', width: 100 },
                                                { title: 'Interpolated', dataIndex: 'interpolated', key: 'interpolated', width: 110 },
                                                { title: 'Tracks', dataIndex: 'tracks', key: 'tracks', width: 90 },
                                                { title: 'Total', dataIndex: 'total_objects', key: 'total_objects', width: 90 },
                                            ]}
                                        />
                                    </>
                                )}
                            </>
                        ),
                    },
                    {
                        key: 'events',
                        label: 'Events',
                        children: (
                            <>
                                <div className='cvat-analytics-kpi-grid cvat-analytics-kpi-grid-4'>
                                    <KpiCard
                                        label='Objects created'
                                        value={totalCreated.toLocaleString()}
                                        hint='Create events in the selected period'
                                    />
                                    <KpiCard
                                        label='Objects deleted'
                                        value={totalDeleted.toLocaleString()}
                                        hint='Delete events in the selected period'
                                    />
                                    <KpiCard
                                        label='Working time'
                                        value={formatHours(totalWorkingMs)}
                                        hint='Active annotation UI time in the period'
                                    />
                                    <KpiCard
                                        label='Annotation speed'
                                        value={avgSpeed}
                                        suffix='/h'
                                        hint='Net objects per working hour'
                                    />
                                </div>

                                <Row gutter={[16, 16]}>
                                    <Col xs={24} lg={12}>
                                        <ChartSection
                                            title='Daily object activity'
                                            meaning='Created vs deleted objects each day in the period.'
                                        >
                                            <Table
                                                size='small'
                                                pagination={false}
                                                locale={{ emptyText: 'No object events in this period' }}
                                                rowKey={(row) => row.date}
                                                dataSource={summary.objects_by_day}
                                                columns={[
                                                    { title: 'Date', dataIndex: 'date', key: 'date' },
                                                    { title: 'Created', dataIndex: 'created', key: 'created' },
                                                    { title: 'Deleted', dataIndex: 'deleted', key: 'deleted' },
                                                    {
                                                        title: 'Net',
                                                        key: 'net',
                                                        render: (_: unknown, row: { created: number; deleted: number }) => (
                                                            row.created - row.deleted
                                                        ),
                                                    },
                                                ]}
                                            />
                                        </ChartSection>
                                    </Col>
                                    <Col xs={24} lg={12}>
                                        <ChartSection
                                            title='Working time by user'
                                            meaning='Active annotation time per user in the period.'
                                        >
                                            <Table
                                                size='small'
                                                pagination={false}
                                                locale={{ emptyText: 'No working-time events' }}
                                                rowKey={(row) => String(row.user_id)}
                                                dataSource={summary.working_time_by_user}
                                                columns={[
                                                    {
                                                        title: 'User',
                                                        dataIndex: 'username',
                                                        key: 'username',
                                                        render: (username: string, row) => (
                                                            username || `user#${row.user_id}`
                                                        ),
                                                    },
                                                    {
                                                        title: 'Time',
                                                        dataIndex: 'ms',
                                                        key: 'ms',
                                                        render: (ms: number) => formatHours(ms),
                                                    },
                                                ]}
                                            />
                                        </ChartSection>
                                    </Col>
                                </Row>

                                <Alert
                                    className='cvat-analytics-legacy-note'
                                    type='info'
                                    showIcon
                                    message='Full event history'
                                    description={(
                                        <span>
                                            Download the complete event log with
                                            {' '}
                                            <Text strong>Export events</Text>
                                            {' '}
                                            in the page header (CSV).
                                        </span>
                                    )}
                                />
                            </>
                        ),
                    },
                ]}
            />

            {showProjectLinks && (
                <div className='cvat-analytics-drilldown'>
                    <Text type='secondary'>
                        Tip: open a project/task/job → Actions → View analytics for a narrower scope.
                        {' '}
                        <Link to='/projects'>Browse projects</Link>
                    </Text>
                </div>
            )}
        </div>
    );
}

export default React.memo(AnalyticsDashboard);
