// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Row, Col } from 'antd/lib/grid';
import Title from 'antd/lib/typography/Title';
import DatePicker from 'antd/lib/date-picker';
import Select from 'antd/lib/select';
import Button from 'antd/lib/button';
import notification from 'antd/lib/notification';
import { DownloadOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import {
    getCore, MembershipRole, AnalyticsEventsFilter, User, Project,
} from 'cvat-core-wrapper';
import { CombinedState } from 'reducers';
import { shallowEqual } from 'utils/redux';
import GoBackButton from 'components/common/go-back-button';
import AnalyticsDashboard from './analytics-dashboard';
import { TimePeriod } from '.';
import {
    defaultLast7DaysIst, toIstDayRange, toPickerDayjs,
} from './date-range';

const core = getCore();

function AnalyticsHubPage(): JSX.Element {
    const initialPeriod = defaultLast7DaysIst();
    const [timePeriod, setTimePeriod] = useState<TimePeriod | null>(initialPeriod);
    const [rangeValue, setRangeValue] = useState<[Dayjs, Dayjs] | null>([
        toPickerDayjs(initialPeriod.startDate),
        toPickerDayjs(initialPeriod.endDate),
    ]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [projectId, setProjectId] = useState<number | undefined>(undefined);
    const [userId, setUserId] = useState<number | undefined>(undefined);
    const [exporting, setExporting] = useState(false);

    const { user, org } = useSelector((state: CombinedState) => ({
        user: state.auth.user,
        org: state.organizations.current,
    }), shallowEqual);

    useEffect(() => {
        core.projects.get({ page: 1, pageSize: 100 })
            .then((result) => setProjects([...result]))
            .catch(() => setProjects([]));

        core.users.get({ limit: 50, is_active: true })
            .then((result: User[]) => setUsers(result))
            .catch(() => setUsers([]));
    }, [org?.slug]);

    const dashboardFilter = useMemo(() => {
        const filter: {
            from?: string;
            to?: string;
            projectId?: number;
            userId?: number;
        } = {};
        if (timePeriod) {
            filter.from = timePeriod.startDate;
            filter.to = timePeriod.endDate;
        }
        if (projectId !== undefined) {
            filter.projectId = projectId;
        }
        if (userId !== undefined) {
            filter.userId = userId;
        }
        return filter;
    }, [timePeriod, projectId, userId]);

    const onExportEvents = useCallback(async () => {
        if (!user) {
            return;
        }

        try {
            setExporting(true);
            const params: AnalyticsEventsFilter = {
                filename: 'export-csv-events-analytics-hub.csv',
            };

            if (timePeriod) {
                params.from = timePeriod.startDate;
                params.to = timePeriod.endDate;
            }
            if (projectId) {
                params.projectId = projectId;
            }
            if (userId) {
                params.userId = userId;
            }

            if (org) {
                const memberships = await org.members(
                    { filter: `{"and":[{"==":[{"var":"user"},"${user.username}"]}]}` },
                );
                const isMaintainer = !!memberships.length &&
                    [MembershipRole.MAINTAINER, MembershipRole.OWNER].includes(memberships[0].role);

                if (!(user.isSuperuser || isMaintainer) && !params.userId) {
                    params.userId = user.id;
                }
            } else if (!user.isSuperuser && !params.userId) {
                params.userId = user.id;
            }

            const url = await core.analytics.events.export(params);
            const a = document.createElement('a');
            try {
                a.setAttribute('href', url);
                a.setAttribute('download', params.filename || 'events.csv');
                a.click();
            } finally {
                a.remove();
            }
        } catch (error: unknown) {
            notification.error({
                message: 'Could not export events',
                description: error instanceof Error ? error.message : '',
            });
        } finally {
            setExporting(false);
        }
    }, [user, org, timePeriod, projectId, userId]);

    return (
        <div className='cvat-analytics-page'>
            <div className='cvat-analytics-wrapper'>
                <Row justify='center'>
                    <Col span={22} xl={18} xxl={14} className='cvat-task-top-bar'>
                        <GoBackButton />
                    </Col>
                </Row>
                <Row justify='center' className='cvat-analytics-inner-wrapper'>
                    <Col span={22} xl={18} xxl={14} className='cvat-analytics-inner'>
                        <Row justify='space-between' align='middle' className='cvat-analytics-hub-header'>
                            <Col>
                                <Title level={4} className='cvat-text-color'>
                                    Analytics overview
                                </Title>
                            </Col>
                            <Col className='cvat-analytics-hub-filters'>
                                <Select
                                    allowClear
                                    placeholder='All projects'
                                    className='cvat-analytics-project-filter'
                                    value={projectId}
                                    onChange={(value) => setProjectId(value)}
                                    options={projects.map((project) => ({
                                        value: project.id,
                                        label: `#${project.id}: ${project.name}`,
                                    }))}
                                    showSearch
                                    optionFilterProp='label'
                                />
                                <Select
                                    allowClear
                                    placeholder='All assignees'
                                    className='cvat-analytics-user-filter'
                                    value={userId}
                                    onChange={(value) => setUserId(value)}
                                    options={users.map((entry) => ({
                                        value: entry.id,
                                        label: entry.username,
                                    }))}
                                    showSearch
                                    optionFilterProp='label'
                                />
                                <DatePicker.RangePicker
                                    value={rangeValue}
                                    placeholder={['IST start date', 'IST end date']}
                                    className='cvat-analytics-date-picker'
                                    onChange={(value) => {
                                        if (value) {
                                            const [from, to] = value;
                                            if (from && to) {
                                                const period = toIstDayRange(from.toDate(), to.toDate());
                                                setRangeValue([
                                                    toPickerDayjs(period.startDate),
                                                    toPickerDayjs(period.endDate),
                                                ]);
                                                setTimePeriod(period);
                                                return;
                                            }
                                        }
                                        const fallback = defaultLast7DaysIst();
                                        setRangeValue([
                                            toPickerDayjs(fallback.startDate),
                                            toPickerDayjs(fallback.endDate),
                                        ]);
                                        setTimePeriod(fallback);
                                    }}
                                />
                                <Button
                                    className='cvat-analytics-export-button'
                                    disabled={exporting}
                                    loading={exporting}
                                    type='link'
                                    icon={<DownloadOutlined />}
                                    onClick={onExportEvents}
                                >
                                    Export events
                                </Button>
                            </Col>
                        </Row>
                        <AnalyticsDashboard
                            filter={dashboardFilter}
                            showProjectLinks
                        />
                    </Col>
                </Row>
            </div>
        </div>
    );
}

export default React.memo(AnalyticsHubPage);
