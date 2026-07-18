// Copyright (C) 2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useCallback } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router';
import Card from 'antd/lib/card';
import Progress from 'antd/lib/progress';
import { MoreOutlined } from '@ant-design/icons';

import { Job, JobType } from 'cvat-core-wrapper';
import { useCardHeightHOC, useContextMenuClick } from 'utils/hooks';
import Preview from 'components/common/preview';
import { CombinedState } from 'reducers';
import JobActionsComponent from './actions-menu';

const useCardHeight = useCardHeightHOC({
    containerClassName: 'cvat-jobs-page',
    siblingClassNames: ['cvat-jobs-page-pagination', 'cvat-jobs-page-top-bar'],
    paddings: 80,
    minHeight: 200,
    numberOfRows: 3,
});

interface Props {
    job: Job;
    selected: boolean;
    onClick: (event: React.MouseEvent) => boolean;
    onApplyFilter?: (filter: string | null) => void;
}

function JobCardComponent(props: Readonly<Props>): JSX.Element {
    const {
        job, selected, onClick, onApplyFilter,
    } = props;

    const deletes = useSelector((state: CombinedState) => state.jobs.activities.deletes);
    const deleted = job.id in deletes ? deletes[job.id] === true : false;

    const history = useHistory();
    const height = useCardHeight();
    const { itemRef, handleContextMenuClick, handleContextMenuCapture } = useContextMenuClick<HTMLDivElement>();

    const openJob = useCallback((event: React.MouseEvent): void => {
        const cancel = onClick(event);
        if (!cancel) {
            const url = `/tasks/${job.taskId}/jobs/${job.id}`;
            if (event.ctrlKey || event.metaKey) {
                window.open(url, '_blank', 'noopener noreferrer');
            } else {
                history.push(url);
            }
        }
    }, [job, onClick, history]);

    const style: React.CSSProperties = { height, cursor: 'pointer' };
    if (deleted) {
        style.pointerEvents = 'none';
        style.opacity = 0.5;
    }

    let tag = null;
    if (job.type === JobType.GROUND_TRUTH) {
        tag = 'Ground truth';
    } else if (job.replicasCount > 0) {
        tag = 'Parent';
    } else if (job.parentJobId !== null) {
        tag = 'Replica';
    }

    const cardClassName = `cvat-job-page-list-item${selected ? ' cvat-item-selected' : ''}`;
    const assignedFrames = job.frameCount ?? (job.stopFrame - job.startFrame + 1);
    const activeFrames = job.activeFrameCount ?? assignedFrames;
    const deletedFrames = Math.max(0, assignedFrames - activeFrames);
    const annotatedFrames = Math.min(job.annotatedFrames ?? 0, activeFrames);
    const annotationProgress = activeFrames > 0 ?
        Math.round((annotatedFrames / activeFrames) * 100) : 0;
    const progressSummary = deletedFrames > 0 ?
        `${annotatedFrames} / ${activeFrames} annotated · ${deletedFrames} deleted (of ${assignedFrames})` :
        `${annotatedFrames} / ${activeFrames} frames annotated`;

    /* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    const card = (
        <Card
            ref={itemRef}
            style={style}
            className={cardClassName}
            cover={(
                <>
                    <Preview
                        job={job}
                        onClick={openJob}
                        loadingClassName='cvat-job-item-loading-preview'
                        emptyPreviewClassName='cvat-job-item-empty-preview'
                        previewWrapperClassName='cvat-jobs-page-job-item-card-preview-wrapper'
                        previewClassName='cvat-jobs-page-job-item-card-preview'
                    />
                    <div className='cvat-job-page-list-item-id'>
                        {`Job #${job.id}`}
                    </div>
                    {tag && <div className='cvat-job-page-list-item-type'>{tag}</div>}
                    <div className='cvat-job-page-list-item-dimension'>{job.dimension.toUpperCase()}</div>
                </>
            )}
            hoverable
            onClick={openJob}
            onContextMenuCapture={handleContextMenuCapture}
        >
            <div className='cvat-job-card-body'>
                <div className='cvat-job-card-stage-state'>
                    <span className='cvat-job-card-label'>Stage &amp; state</span>
                    <span className='cvat-job-card-value cvat-job-card-stage-pill'>
                        {`${job.stage} · ${job.state}`}
                    </span>
                </div>
                <div className='cvat-job-card-annotation-progress'>
                    <div className='cvat-job-card-progress-header'>
                        <span className='cvat-job-card-label'>Progress</span>
                        <span className='cvat-job-card-progress-percent'>{`${annotationProgress}%`}</span>
                    </div>
                    <Progress
                        percent={annotationProgress}
                        size='small'
                        showInfo={false}
                        strokeColor='#1890FF'
                        trailColor='rgba(0, 0, 0, 0.06)'
                    />
                    <span className='cvat-job-card-progress-summary'>{progressSummary}</span>
                </div>
                <div className='cvat-job-card-assignee'>
                    <span className='cvat-job-card-label'>Assignee</span>
                    <span className='cvat-job-card-value'>
                        {job.assignee ? job.assignee.username : '—'}
                    </span>
                </div>
            </div>
            <div
                onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                    handleContextMenuClick(event);
                }}
                className='cvat-job-card-more-button cvat-actions-menu-button'
            >
                <MoreOutlined className='cvat-menu-icon' />
            </div>
        </Card>
    );

    return (
        <JobActionsComponent
            jobInstance={job}
            dropdownTrigger={['contextMenu']}
            triggerElement={card}
            onApplyFilter={onApplyFilter}
        />
    );
}

export default React.memo(JobCardComponent);
