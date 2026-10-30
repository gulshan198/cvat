// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useMemo } from 'react';
import Title from 'antd/lib/typography/Title';
import Button from 'antd/lib/button';
import DatePicker from 'antd/lib/date-picker';
import { Row, Col } from 'antd/lib/grid';
import { DownloadOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import dayjs from 'utils/dayjs-wrapper';

import { Project, Task, Job } from 'cvat-core-wrapper';
import ResourceLink from 'components/common/resource-link';
import { TimePeriod } from '.';

interface Props {
    onExportEvents(): void;
    onUpdateTimePeriod(from: Date | null, to: Date | null): void;
    resource: Project | Task | Job;
    timePeriod?: TimePeriod | null;
    exporting: boolean;
    fetching: boolean;
}

function AnaylyticsPageHeader(props: Props): JSX.Element {
    const {
        onUpdateTimePeriod,
        onExportEvents,
        resource,
        timePeriod,
        exporting,
        fetching,
    } = props;

    const rangeValue = useMemo((): [Dayjs, Dayjs] | null => {
        if (!timePeriod?.startDate || !timePeriod?.endDate) {
            return null;
        }
        return [dayjs.utc(timePeriod.startDate), dayjs.utc(timePeriod.endDate)];
    }, [timePeriod?.startDate, timePeriod?.endDate]);

    return (
        <Row justify='space-between' align='middle'>
            <Col className='cvat-analytics-header'>
                <Title level={4} className='cvat-text-color'>
                    {'Analytics for '}
                    <ResourceLink resource={resource} />
                </Title>
            </Col>
            <Col>
                <DatePicker.RangePicker
                    value={rangeValue}
                    placeholder={['UTC start day', 'UTC end day']}
                    className='cvat-analytics-date-picker'
                    allowEmpty={[false, false]}
                    onChange={(value) => {
                        if (value) {
                            const [from, to] = value;
                            if (from && to) {
                                onUpdateTimePeriod(from.toDate(), to.toDate());
                            }
                        } else {
                            onUpdateTimePeriod(null, null);
                        }
                    }}
                />
                <Button
                    className='cvat-analytics-export-button'
                    disabled={fetching || exporting}
                    loading={exporting}
                    type='link'
                    icon={<DownloadOutlined />}
                    onClick={onExportEvents}
                >
                    Export events
                </Button>
            </Col>
        </Row>
    );
}

export default React.memo(AnaylyticsPageHeader);
