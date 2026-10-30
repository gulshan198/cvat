// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Row, Col } from 'antd/lib/grid';
import Alert from 'antd/lib/alert';
import Card from 'antd/lib/card';
import Empty from 'antd/lib/empty';
import Statistic from 'antd/lib/statistic';
import Table from 'antd/lib/table';
import Tabs from 'antd/lib/tabs';
import Text from 'antd/lib/typography/Text';
import Title from 'antd/lib/typography/Title';
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

function formatHours(ms: number): string {
    return `${(ms / 3600000).toFixed(2)}h`;
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
                    <Text strong>{title}</Text>
                    {extra}
                </div>
            )}
        >
            <Text type='secondary' className='cvat-analytics-section-meaning'>
                {meaning}
            </Text>
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
        `${summary.period.from.slice(0, 10)} → ${summary.period.to.slice(0, 10)} (UTC)` :
        'selected period';

    const detectionTypeKeys = Array.from(new Set(
        (inventory?.detections || []).flatMap((row) => Object.keys(row.by_type || {})),
    )).sort();
    const trackingTypeKeys = Array.from(new Set(
        (inventory?.tracking || []).flatMap((row) => Object.keys(row.by_type || {})),
    )).sort();

    return (
        <div className='cvat-analytics-dashboard'>
            <Alert
                className='cvat-analytics-glossary'
                type='info'
                showIcon
                message='How to read this dashboard'
                description={(
                    <ul className='cvat-analytics-glossary-list'>
                        <li>
                            <Text strong>Annotated images (= done)</Text>
                            {' — frames where someone actually annotated (drew/saved). '}
                            If an image is annotated, it counts as done.
                        </li>
                        <li>
                            <Text strong>Images assigned</Text>
                            {' — frames inside jobs that were '}
                            <Text strong>given to a person</Text>
                            {' in this period (size of those jobs).'}
                        </li>
                        <li>
                            Dates are UTC full days. A single-day pick covers 00:00–23:59 UTC.
                        </li>
                    </ul>
                )}
            />

            <Text type='secondary' className='cvat-analytics-period-label'>
                Showing:
                {' '}
                {periodLabel}
            </Text>

            {!summary.has_frame_label_data && (
                <Alert
                    className='cvat-analytics-legacy-note'
                    type='warning'
                    showIcon
                    message='Limited label detail on older events'
                    description={(
                        'Events recorded before analytics enrichment may not include frame/label fields. '
                        + 'Hover breakdown by label works for new annotations going forward.'
                    )}
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
                                <Title level={5} className='cvat-analytics-block-title'>
                                    Period totals (Premium Summary metrics)
                                </Title>
                                <Row gutter={[16, 16]} className='cvat-analytics-summary-cards'>
                                    <Col xs={24} sm={12} lg={8} xl={4}>
                                        <Card size='small' className='cvat-analytics-kpi-card'>
                                            <Statistic title='Objects diff' value={objectsDiff} />
                                            <Text type='secondary' className='cvat-analytics-kpi-hint'>
                                                Created minus deleted objects (Premium)
                                            </Text>
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8} xl={4}>
                                        <Card size='small' className='cvat-analytics-kpi-card'>
                                            <Statistic title='Total working time' value={formatHours(totalWorkingMs)} />
                                            <Text type='secondary' className='cvat-analytics-kpi-hint'>
                                                Active annotation UI time (Premium)
                                            </Text>
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8} xl={4}>
                                        <Card size='small' className='cvat-analytics-kpi-card'>
                                            <Statistic
                                                title='Avg. annotation speed'
                                                value={avgSpeed}
                                                suffix='/h'
                                            />
                                            <Text type='secondary' className='cvat-analytics-kpi-hint'>
                                                Net objects per working hour (Premium)
                                            </Text>
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8} xl={4}>
                                        <Card size='small' className='cvat-analytics-kpi-card'>
                                            <Statistic title='Annotated images' value={totalAnnotated} />
                                            <Text type='secondary' className='cvat-analytics-kpi-hint'>
                                                Frames annotated (= done)
                                            </Text>
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8} xl={4}>
                                        <Card size='small' className='cvat-analytics-kpi-card'>
                                            <Statistic title='Images assigned' value={totalAssigned} />
                                            <Text type='secondary' className='cvat-analytics-kpi-hint'>
                                                Frames in newly assigned jobs
                                            </Text>
                                        </Card>
                                    </Col>
                                    <Col xs={24} sm={12} lg={8} xl={4}>
                                        <Card size='small' className='cvat-analytics-kpi-card'>
                                            <Statistic title='Created / deleted' value={`${totalCreated} / ${totalDeleted}`} />
                                            <Text type='secondary' className='cvat-analytics-kpi-hint'>
                                                Raw object create vs delete counts
                                            </Text>
                                        </Card>
                                    </Col>
                                </Row>

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
                                                        'How many distinct images/frames received new annotations each UTC day. '
                                                        + 'Hover a bar to see which labels were used.'
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
                                                    meaning={
                                                        'Premium annotation-speed chart: net objects (created − deleted) per UTC day.'
                                                    }
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
                                <Alert
                                    className='cvat-analytics-legacy-note'
                                    type='info'
                                    showIcon
                                    message='Current inventory (not date-filtered)'
                                    description={
                                        'Same as Premium Annotations tab: live counts of shapes/tags/tracks on this resource right now. '
                                        + 'Date range above does not change this table.'
                                    }
                                />
                                <Row gutter={[16, 16]} className='cvat-analytics-summary-cards'>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Shapes' value={inventory?.totals.shapes ?? 0} />
                                        </Card>
                                    </Col>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Tags' value={inventory?.totals.tags ?? 0} />
                                        </Card>
                                    </Col>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Tracks' value={inventory?.totals.tracks ?? 0} />
                                        </Card>
                                    </Col>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Images' value={inventory?.totals.images ?? 0} />
                                        </Card>
                                    </Col>
                                </Row>

                                <Title level={5} className='cvat-analytics-block-title'>Detections (shapes)</Title>
                                <Table
                                    size='small'
                                    className='cvat-analytics-inventory-table'
                                    rowKey={(row) => `det-${row.label_id}`}
                                    pagination={{ pageSize: 20 }}
                                    locale={{ emptyText: 'No shapes or tags on this resource' }}
                                    dataSource={inventory?.detections || []}
                                    columns={[
                                        { title: 'Label ID', dataIndex: 'label_id', key: 'label_id', width: 90 },
                                        { title: 'Label name', dataIndex: 'label_name', key: 'label_name' },
                                        ...detectionTypeKeys.map((type) => ({
                                            title: type,
                                            key: `det-type-${type}`,
                                            render: (_: unknown, row: { by_type: Record<string, number> }) => (
                                                row.by_type?.[type] || 0
                                            ),
                                        })),
                                        { title: 'Tags', dataIndex: 'tags', key: 'tags', width: 80 },
                                        { title: 'Total shapes', dataIndex: 'total_shapes', key: 'total_shapes', width: 120 },
                                    ]}
                                />

                                <Title level={5} className='cvat-analytics-block-title'>Tracking</Title>
                                <Table
                                    size='small'
                                    className='cvat-analytics-inventory-table'
                                    rowKey={(row) => `trk-${row.label_id}`}
                                    pagination={{ pageSize: 20 }}
                                    locale={{ emptyText: 'No tracks on this resource' }}
                                    dataSource={inventory?.tracking || []}
                                    columns={[
                                        { title: 'Label ID', dataIndex: 'label_id', key: 'label_id', width: 90 },
                                        { title: 'Label name', dataIndex: 'label_name', key: 'label_name' },
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
                                        { title: 'Total objects', dataIndex: 'total_objects', key: 'total_objects', width: 120 },
                                    ]}
                                />
                            </>
                        ),
                    },
                    {
                        key: 'events',
                        label: 'Events',
                        children: (
                            <>
                                <Row gutter={[16, 16]} className='cvat-analytics-summary-cards'>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic
                                                title='Total objects (current)'
                                                value={
                                                    (inventory?.totals.shapes ?? 0)
                                                    + (inventory?.totals.tags ?? 0)
                                                    + (inventory?.totals.tracks ?? 0)
                                                }
                                            />
                                        </Card>
                                    </Col>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Total images' value={inventory?.totals.images ?? 0} />
                                        </Card>
                                    </Col>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Total working time' value={formatHours(totalWorkingMs)} />
                                        </Card>
                                    </Col>
                                    <Col xs={12} sm={6}>
                                        <Card size='small'>
                                            <Statistic title='Avg. annotation speed' value={avgSpeed} suffix='/h' />
                                        </Card>
                                    </Col>
                                </Row>
                                <Alert
                                    type='info'
                                    showIcon
                                    message='Event history export'
                                    description={(
                                        <span>
                                            Premium’s Events table (grouped by assignee / stage / state / user) is available
                                            as CSV via
                                            {' '}
                                            <Text strong>Export events</Text>
                                            {' '}
                                            in the page header. Open that download for the full per-event history.
                                            {showProjectLinks ? (
                                                <>
                                                    {' '}
                                                    Hub view can also filter by project/user before export.
                                                </>
                                            ) : null}
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
