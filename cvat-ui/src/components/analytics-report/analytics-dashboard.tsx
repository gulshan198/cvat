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
import Text from 'antd/lib/typography/Text';
import Title from 'antd/lib/typography/Title';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Tooltip,
    Legend,
    ChartOptions,
    TooltipItem,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

import { getCore } from 'cvat-core-wrapper';
import type { SerializedAnalyticsSummary } from 'cvat-core/src/server-response-types';
import CVATLoadingSpinner from 'components/common/loading-spinner';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

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

function formatHours(ms: number): string {
    return `${(ms / 3600000).toFixed(2)}h`;
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
                    label: 'Annotated images',
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
                                    return ['No label breakdown available'];
                                }
                                return [
                                    'By label:',
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
                        title: { display: true, text: 'Images' },
                    },
                },
            } as ChartOptions<'bar'>,
        };
    }, [summary]);

    const assigneeChart = useMemo(() => {
        if (!summary) {
            return null;
        }
        const labels = summary.assignee_workload.map((row) => row.username || `user#${row.user_id}`);
        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Images assigned',
                        data: summary.assignee_workload.map((row) => row.images_assigned),
                        backgroundColor: 'rgba(250, 173, 20, 0.65)',
                    },
                    {
                        label: 'Images done',
                        data: summary.assignee_workload.map((row) => row.images_done),
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
                        title: { display: true, text: 'Images' },
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
                        label: 'Created',
                        data: summary.objects_by_day.map((row) => row.created),
                        backgroundColor: 'rgba(24, 144, 255, 0.65)',
                    },
                    {
                        label: 'Deleted',
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
                    label: 'Working time (hours)',
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
    const totalDone = summary.assignee_workload.reduce((acc, row) => acc + row.images_done, 0);
    const totalWorkingMs = summary.working_time_by_user.reduce((acc, row) => acc + row.ms, 0);
    const hasAnySeries = totalAnnotated > 0 ||
        totalAssigned > 0 ||
        totalDone > 0 ||
        summary.objects_by_day.some((row) => row.created || row.deleted) ||
        totalWorkingMs > 0;

    return (
        <div className='cvat-analytics-dashboard'>
            <Text type='secondary' className='cvat-analytics-help'>
                Annotated image = distinct frames with create events in the period.
                Assigned = frames in jobs whose assignee changed in the period.
                Done = frames in jobs that reached acceptance/completed in the period.
            </Text>
            {!summary.has_frame_label_data && (
                <Alert
                    className='cvat-analytics-legacy-note'
                    type='info'
                    showIcon
                    message='Label/frame breakdown needs enriched events'
                    description={(
                        'Older events only store object counts. New annotations will include '
                        + 'frame and label details for hover breakdowns.'
                    )}
                />
            )}

            <Row gutter={[16, 16]} className='cvat-analytics-summary-cards'>
                <Col xs={12} sm={6}>
                    <Card size='small'>
                        <Statistic title='Annotated images' value={totalAnnotated} />
                    </Card>
                </Col>
                <Col xs={12} sm={6}>
                    <Card size='small'>
                        <Statistic title='Images assigned' value={totalAssigned} />
                    </Card>
                </Col>
                <Col xs={12} sm={6}>
                    <Card size='small'>
                        <Statistic title='Images done' value={totalDone} />
                    </Card>
                </Col>
                <Col xs={12} sm={6}>
                    <Card size='small'>
                        <Statistic title='Working time' value={formatHours(totalWorkingMs)} />
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} className='cvat-analytics-pipeline-row'>
                <Col span={24}>
                    <Card size='small' title='Current pipeline snapshot'>
                        <Row gutter={16}>
                            <Col xs={12} sm={6}><Statistic title='Annotation' value={summary.pipeline.annotation} /></Col>
                            <Col xs={12} sm={6}><Statistic title='Validation' value={summary.pipeline.validation} /></Col>
                            <Col xs={12} sm={6}><Statistic title='Acceptance' value={summary.pipeline.acceptance} /></Col>
                            <Col xs={12} sm={6}><Statistic title='Completed state' value={summary.pipeline.completed} /></Col>
                        </Row>
                    </Card>
                </Col>
            </Row>

            {!hasAnySeries ? (
                <Empty description='No activity in the selected period' />
            ) : (
                <>
                    <Row gutter={[16, 16]}>
                        <Col span={24}>
                            <Card
                                size='small'
                                title='Annotated images by day'
                                className='cvat-analytics-chart-card'
                            >
                                <div className='cvat-analytics-chart'>
                                    {annotatedChart && totalAnnotated > 0 ? (
                                        <Bar data={annotatedChart.data} options={annotatedChart.options} />
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No annotated images' />
                                    )}
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                            <Card
                                size='small'
                                title='Assignee: assigned vs done'
                                className='cvat-analytics-chart-card'
                            >
                                <div className='cvat-analytics-chart'>
                                    {assigneeChart && summary.assignee_workload.length ? (
                                        <Bar data={assigneeChart.data} options={assigneeChart.options} />
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No assignee activity' />
                                    )}
                                </div>
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card
                                size='small'
                                title='Objects created vs deleted'
                                className='cvat-analytics-chart-card'
                            >
                                <div className='cvat-analytics-chart'>
                                    {objectsChart && summary.objects_by_day.length ? (
                                        <Bar data={objectsChart.data} options={objectsChart.options} />
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No object events' />
                                    )}
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                            <Card
                                size='small'
                                title='Working time by user'
                                className='cvat-analytics-chart-card'
                            >
                                <div className='cvat-analytics-chart'>
                                    {workingTimeChart && summary.working_time_by_user.length ? (
                                        <Bar data={workingTimeChart.data} options={workingTimeChart.options} />
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No working time data' />
                                    )}
                                </div>
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card size='small' title='Top contributors'>
                                <Table
                                    size='small'
                                    rowKey={(row) => String(row.user_id)}
                                    pagination={false}
                                    dataSource={summary.top_contributors}
                                    columns={[
                                        {
                                            title: 'User',
                                            dataIndex: 'username',
                                            key: 'username',
                                            render: (username: string, row) => username || `user#${row.user_id}`,
                                        },
                                        {
                                            title: 'Annotated images',
                                            dataIndex: 'images',
                                            key: 'images',
                                        },
                                    ]}
                                />
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            {showProjectLinks && summary.assignee_workload.length > 0 && (
                <div className='cvat-analytics-drilldown'>
                    <Title level={5}>Tip</Title>
                    <Text type='secondary'>
                        Open a project, task, or job and use Actions → View analytics for scoped drill-down.
                        {' '}
                        <Link to='/projects'>Browse projects</Link>
                    </Text>
                </div>
            )}
        </div>
    );
}

export default React.memo(AnalyticsDashboard);
