// Copyright (C) 2021-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect } from 'react';
import Mousetrap from 'mousetrap';
import { ShortcutScope } from './enums';

export interface KeyMapItem {
    name: string;
    description: string;
    sequences: string[];
    displayedSequences?: string[];
    scope: ShortcutScope;
    nonActive?: boolean;
    applicable?: string[];
    displayWeight?: number;
}

export interface KeyMap {
    [index: string]: KeyMapItem;
}

export interface Handlers {
    [index: string]: (event: KeyboardEvent, shortcut: string) => void;
}

interface Props {
    children?: JSX.Element;
    keyMap: KeyMap;
    handlers: Handlers;
}

const applicationKeyMap: KeyMap = {};

/**
 * Expand ctrl/command modifiers so Mac Cmd and Windows/Linux Ctrl both work.
 * Cached client settings often store only ctrl+… sequences, which break Cmd on macOS.
 *
 * Note: Mousetrap treats 'command' and 'meta' as the SAME key internally, so we must
 * normalize 'meta' to 'command' and never emit both — otherwise two callbacks get bound
 * to one physical combination and handlers fire twice per keypress.
 */
export function expandPlatformSequences(sequences: string[]): string[] {
    const expanded = new Set<string>();

    for (const sequence of sequences) {
        if (!sequence?.trim()) {
            continue;
        }

        const parts = sequence.toLowerCase().split('+')
            .map((part) => (part === 'meta' ? 'command' : part));
        const normalized = parts.join('+');
        expanded.add(normalized);

        const replaceModifier = (from: string, to: string): string => (
            parts.map((part) => (part === from ? to : part)).join('+')
        );

        if (parts.includes('ctrl')) {
            expanded.add(replaceModifier('ctrl', 'command'));
        }
        if (parts.includes('command')) {
            expanded.add(replaceModifier('command', 'ctrl'));
        }
    }

    return Array.from(expanded);
}

export default function GlobalHotKeys(props: Props): JSX.Element {
    const { children, keyMap, handlers } = props;
    useEffect(() => {
        const boundSequencesByKey: Record<string, string[]> = {};

        for (const key of Object.keys(keyMap)) {
            const { sequences } = keyMap[key];
            const handler = handlers[key];
            const expandedSequences = expandPlatformSequences(sequences);
            boundSequencesByKey[key] = expandedSequences;

            if (!expandedSequences.length) {
                applicationKeyMap[key] = keyMap[key];
                continue;
            }

            Mousetrap.bind(expandedSequences, (event, combo) => {
                event.preventDefault();
                event.stopPropagation();
                if (handler) {
                    handler(event, combo);
                }
            }, 'keydown');
            applicationKeyMap[key] = keyMap[key];
        }

        return () => {
            for (const key of Object.keys(boundSequencesByKey)) {
                const sequences = boundSequencesByKey[key];
                if (sequences.length) {
                    Mousetrap.unbind(sequences, 'keydown');
                }
                delete applicationKeyMap[key];
            }
        };
    });
    return children || <></>;
}

Mousetrap.prototype.stopCallback = function (e: KeyboardEvent, element: Element, combo: string): boolean {
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
        // do not trigger any shortcuts if input field is one of [input, select, textarea]
        return true;
    }

    const activeSequences = Object.values(applicationKeyMap)
        .map((keyMapItem) => expandPlatformSequences(keyMapItem.sequences))
        .flat();
    if (activeSequences.some((sequence) => sequence.startsWith(combo))) {
        // prevent default behaviour of the event if potentially one of active shortcuts will be triggered
        e?.preventDefault();
    }

    // stop when modals are opened
    const anyModalsOpened = Array.from(
        window.document.getElementsByClassName('ant-modal'),
    ).some((el) => (el as HTMLElement).style.display !== 'none');

    if (anyModalsOpened) {
        const modalClosingSequences = ['SWITCH_SHORTCUTS', 'SWITCH_SETTINGS']
            .map((key) => expandPlatformSequences(applicationKeyMap[key]?.sequences ?? [])).flat();

        return !modalClosingSequences.some((seq) => {
            const seqFragments = seq.split('+');
            return combo.split('+').every((key, i) => seqFragments[i] === key);
        });
    }

    return false;
};

export function getApplicationKeyMap(): KeyMap {
    return {
        ...applicationKeyMap,
    };
}
