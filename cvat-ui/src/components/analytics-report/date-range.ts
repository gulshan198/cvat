// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import dayjs from 'utils/dayjs-wrapper';
import { TimePeriod } from '.';

/**
 * Ant Design RangePicker often returns both ends at 00:00 for calendar days.
 * For a single day that makes from === to and the query window is empty.
 * Normalize to full UTC days: start 00:00:00.000 → end 23:59:59.999.
 */
export function toUtcDayRange(from: Date, to: Date): TimePeriod {
    const start = dayjs.utc(
        new Date(Number(from) - from.getTimezoneOffset() * 60000).toISOString(),
    ).startOf('day');
    const end = dayjs.utc(
        new Date(Number(to) - to.getTimezoneOffset() * 60000).toISOString(),
    ).endOf('day');

    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
    };
}

export function defaultLast7DaysUtc(): TimePeriod {
    const end = dayjs.utc().endOf('day');
    const start = end.subtract(6, 'day').startOf('day');
    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
    };
}
