// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';

import React, {
    useEffect, useState,
} from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { Col, Row } from 'antd/lib/grid';
import Card from 'antd/lib/card';
import Text from 'antd/lib/typography/Text';
import {
    LoadingOutlined, MoreOutlined, QuestionCircleOutlined,
} from '@ant-design/icons/lib/icons';
import Progress from 'antd/lib/progress';
import {
    Job, JobStage, JobState, JobType, Task, User, MediaType,
} from 'cvat-core-wrapper';
import { formatTimeShort } from 'audio/utils/format-audio-time';
import { useIsMounted, useContextMenuClick } from 'utils/hooks';
import UserSelector from 'components/task-page/user-selector';
import CVATTooltip from 'components/common/cvat-tooltip';
import { CombinedState } from 'reducers';
import CVATTag, { TagType } from 'components/common/cvat-tag';
import JobActionsComponent from 'components/jobs-page/actions-menu';
import { JobStageSelector, JobStateSelector } from './job-selectors';

function formatDate(value: dayjs.Dayjs): string {
    return value.format('MMM Do YYYY HH:mm');
}

interface Props {
    job: Job;
    task: Task;
    onJobUpdate: (job: Job, fields: Parameters<Job['save']>[0]) => void;
    selected?: boolean;
    onClick?: (event?: React.MouseEvent) => void;
    onApplyFilter?: (filter: string | null) => void;
}

function ReviewSummaryComponent({ jobInstance }: Readonly<{ jobInstance: Job }>): JSX.Element {
    const [summary, setSummary] = useState<Record<string, any> | null>(null);
    const [error, setError] = useState<any>(null);
    const isMounted = useIsMounted();

    useEffect(() => {
        setError(null);
        jobInstance
            .issues()
            .then((issues: any[]) => {
                if (isMounted()) {
                    setSummary({
                        issues_unsolved: issues.filter((issue) => !issue.resolved).length,
                        issues_resolved: issues.filter((issue) => issue.resolved).length,
                    });
                }
            })
            .catch((_error: any) => {
                if (isMounted()) {
                    console.log(_error);
                    setError(_error);
                }
            });
    }, []);

    if (!summary) {
        if (error) {
            if (error.toString().includes('403')) {
                return <p>You do not have permissions</p>;
            }

            return <p>Could not fetch, check console output</p>;
        }

        return (
            <>
                <p>Loading.. </p>
                <LoadingOutlined />
            </>
        );
    }

    return (
        <table className='cvat-review-summary-description'>
            <tbody>
                <tr>
                    <td>
                        <Text strong>Unsolved issues</Text>
                    </td>
                    <td>{summary.issues_unsolved}</td>
                </tr>
                <tr>
                    <td>
                        <Text strong>Resolved issues</Text>
                    </td>
                    <td>{summary.issues_resolved}</td>
                </tr>
            </tbody>
        </table>
    );
}

function JobItem(props: Readonly<Props>): JSX.Element {
    const {
        job, task, onJobUpdate, selected, onClick, onApplyFilter,
    } = props;

    const deletes = useSelector((state: CombinedState) => state.jobs.activities.deletes);
    const canEditAssignee = useSelector((state: CombinedState) => !!state.auth.user?.isStaff);
    const deleted = job.id in deletes ? deletes[job.id] === true : false;
    const { itemRef, handleContextMenuClick, handleContextMenuCapture } = useContextMenuClick<HTMLDivElement>();

    const { stage, state } = job;
    const created = dayjs(job.createdDate);
    const updated = dayjs(job.updatedDate);

    const style = {};
    if (deleted) {
        (style as any).pointerEvents = 'none';
        (style as any).opacity = 0.5;
    }

    const isAudioTask = task.mediaType === MediaType.AUDIO;
    const totalFrames = job.activeFrameCount ?? job.frameCount;
    const annotatedFrames = Math.min(job.annotatedFrames ?? 0, totalFrames);
    const annotationProgress = totalFrames > 0 ?
        Math.round((annotatedFrames / totalFrames) * 100) : 0;
    const audioJobDuration = isAudioTask ? formatTimeShort(job.frameCount / 1000) : '';
    const audioJobRange = isAudioTask ?
        `${formatTimeShort(job.startFrame / 1000)} – ${formatTimeShort(job.stopFrame / 1000)}` : '';
    const jobName = `Job #${job.id}`;
    const progressLabel = isAudioTask ?
        audioJobDuration :
        `${annotatedFrames} / ${totalFrames} frames`;
    const rangeLabel = isAudioTask ? audioJobRange : `${job.startFrame}–${job.stopFrame}`;

    let tag = null;
    if (job.type === JobType.GROUND_TRUTH) {
        tag = (
            <Col offset={1}>
                <CVATTag type={TagType.GROUND_TRUTH} />
            </Col>
        );
    } else if (job.replicasCount > 0) {
        tag = (
            <Col offset={1}>
                <CVATTag type={TagType.PARENT} />
            </Col>
        );
    } else if (job.parentJobId !== null) {
        tag = (
            <Col offset={1}>
                <CVATTag type={TagType.REPLICA} />
            </Col>
        );
    }

    /* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    const card = (
        <Card
            ref={itemRef}
            className={`cvat-job-item${selected ? ' cvat-item-selected' : ''}`}
            style={{ ...style }}
            data-row-id={job.id}
            onClick={onClick}
            onContextMenuCapture={handleContextMenuCapture}
        >
            <Row align='middle' gutter={[16, 8]}>
                <Col xs={24} md={6}>
                    <Row align='middle'>
                        <Col>
                            <Link className='cvat-job-item-title' to={`/tasks/${job.taskId}/jobs/${job.id}`}>
                                {jobName}
                            </Link>
                        </Col>
                        {tag}
                        {job.type !== JobType.GROUND_TRUTH && (
                            <Col className='cvat-job-item-issues-summary-icon'>
                                <CVATTooltip title={<ReviewSummaryComponent jobInstance={job} />}>
                                    <QuestionCircleOutlined />
                                </CVATTooltip>
                            </Col>
                        )}
                    </Row>
                    <div className='cvat-job-item-meta'>
                        <Text type='secondary'>
                            {`Updated ${updated.fromNow()}`}
                        </Text>
                        <Text type='secondary' className='cvat-job-item-created'>
                            {`Created ${formatDate(created)}`}
                        </Text>
                    </div>
                </Col>
                <Col xs={24} md={10}>
                    <Row className='cvat-job-item-selects' gutter={[8, 8]}>
                        <Col className='cvat-job-item-select'>
                            <Text type='secondary' className='cvat-job-item-select-label'>Assignee</Text>
                            {canEditAssignee ? (
                                <UserSelector
                                    className='cvat-job-assignee-selector'
                                    value={job.assignee}
                                    onSelect={(user: User | null): void => {
                                        if (job?.assignee?.id === user?.id) return;
                                        onJobUpdate(job, { assignee: user });
                                    }}
                                />
                            ) : (
                                <Text>{job.assignee ? job.assignee.username : '—'}</Text>
                            )}
                        </Col>
                        <Col className='cvat-job-item-select'>
                            <Text type='secondary' className='cvat-job-item-select-label'>Stage</Text>
                            <JobStageSelector
                                value={stage}
                                onSelect={(newValue: JobStage) => {
                                    onJobUpdate(job, { stage: newValue });
                                }}
                            />
                        </Col>
                        <Col className='cvat-job-item-select'>
                            <Text type='secondary' className='cvat-job-item-select-label'>State</Text>
                            <JobStateSelector
                                value={state}
                                onSelect={(newValue: JobState) => {
                                    onJobUpdate(job, { state: newValue });
                                }}
                            />
                        </Col>
                    </Row>
                </Col>
                <Col xs={24} md={7}>
                    <div className='cvat-job-item-progress'>
                        <div className='cvat-job-item-progress-header'>
                            <Text strong>{progressLabel}</Text>
                            {!isAudioTask && (
                                <Text type='secondary'>{`${annotationProgress}%`}</Text>
                            )}
                        </div>
                        {!isAudioTask && (
                            <Progress
                                percent={annotationProgress}
                                size='small'
                                showInfo={false}
                                strokeColor='#1890FF'
                            />
                        )}
                        {job.type !== JobType.GROUND_TRUTH && (
                            <Text type='secondary' className='cvat-job-item-frame-range'>
                                {isAudioTask ? `Time ${rangeLabel}` : `Frames ${rangeLabel}`}
                            </Text>
                        )}
                    </div>
                </Col>
            </Row>
            <div
                onClick={handleContextMenuClick}
                className='cvat-job-item-more-button cvat-actions-menu-button'
            >
                <MoreOutlined className='cvat-menu-icon' />
            </div>
        </Card>
    );

    return (
        <Col span={24}>
            <JobActionsComponent
                jobInstance={job}
                dropdownTrigger={['contextMenu']}
                triggerElement={card}
                onApplyFilter={onApplyFilter}
            />
        </Col>
    );
}

export default React.memo(JobItem);
