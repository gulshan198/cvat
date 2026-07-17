// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import notification from 'antd/lib/notification';
import Text from 'antd/lib/typography/Text';
import SelectCloudStorage from 'components/select-cloud-storage/select-cloud-storage';
import {
    getCore, FramesMetaData, StorageLocation, CloudStorage,
} from 'cvat-core-wrapper';

interface Props {
    taskMeta: FramesMetaData,
    cloudStorageInstance: CloudStorage | null,
    onUpdateTaskMeta: (meta: FramesMetaData) => Promise<void>;
}

export async function getCloudStorageById(id: number): Promise<CloudStorage | null> {
    try {
        const [data] = await getCore().cloudStorages.get({ id });
        return data;
    } catch (error: any) {
        notification.error({
            message: 'Could not fetch a cloud storage',
            description: error.toString(),
        });
    }
    return null;
}

export default function CloudStorageEditorComponent(props: Props): JSX.Element | null {
    const { taskMeta, cloudStorageInstance, onUpdateTaskMeta } = props;

    const [searchPhrase, setSearchPhrase] = useState(cloudStorageInstance ? cloudStorageInstance.displayName : '');

    const label = <Text type='secondary'>Cloud storage</Text>;

    if (taskMeta.storage !== StorageLocation.CLOUD_STORAGE) {
        return null;
    }

    const storagePrefix = cloudStorageInstance?.prefix;
    const bucketName = cloudStorageInstance?.resource;

    return (
        <div className='cvat-task-cloud-storage-editor'>
            <SelectCloudStorage
                searchPhrase={searchPhrase}
                cloudStorage={cloudStorageInstance}
                setSearchPhrase={setSearchPhrase}
                onSelectCloudStorage={(_cloudStorage: CloudStorage | null) => {
                    if (_cloudStorage) {
                        taskMeta.cloudStorageId = _cloudStorage.id;
                        onUpdateTaskMeta(taskMeta);
                    } else {
                        setSearchPhrase(cloudStorageInstance ? cloudStorageInstance.displayName : '');
                    }
                }}
                label={label}
            />
            {cloudStorageInstance && (bucketName || storagePrefix) && (
                <div className='cvat-task-cloud-storage-path'>
                    <Text type='secondary'>
                        {bucketName ? `Bucket: ${bucketName}` : null}
                        {bucketName && storagePrefix ? ' · ' : null}
                        {storagePrefix ? `Prefix: ${storagePrefix}` : null}
                    </Text>
                </div>
            )}
        </div>
    );
}
