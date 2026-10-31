// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import dayjs from 'utils/dayjs-wrapper';
import { TimePeriod } from '.';

/** Analytics UI timezone — India Standard Time. */
export const ANALYTICS_TZ = 'Asia/Kolkata';

/**
 * Ant Design RangePicker often returns both ends at 00:00 for calendar days.
 * Normalize to full IST days, then send ISO (UTC) to the API.
 */
export function toIstDayRange(from: Date, to: Date): TimePeriod {
    const start = dayjs(from).tz(ANALYTICS_TZ).startOf('day');
    const end = dayjs(to).tz(ANALYTICS_TZ).endOf('day');

    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
    };
}

/** @deprecated use toIstDayRange — kept as alias so older imports keep working */
export const toUtcDayRange = toIstDayRange;

export function defaultLast7DaysIst(): TimePeriod {
    const end = dayjs().tz(ANALYTICS_TZ).endOf('day');
    const start = end.subtract(6, 'day').startOf('day');
    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
    };
}

/** @deprecated use defaultLast7DaysIst */
export const defaultLast7DaysUtc = defaultLast7DaysIst;

export function formatPeriodIst(fromIso: string, toIso: string): string {
    const start = dayjs(fromIso).tz(ANALYTICS_TZ).format('DD MMM YYYY');
    const end = dayjs(toIso).tz(ANALYTICS_TZ).format('DD MMM YYYY');
    return `${start} → ${end} (IST)`;
}

export function toPickerDayjs(iso: string) {
    return dayjs(iso).tz(ANALYTICS_TZ);
}
