'use strict';

function findBalancedObjectLiteral(source, startToken) {
    const start = source.indexOf(startToken);
    if (start === -1) return null;

    const openIndex = source.indexOf('{', start);
    if (openIndex === -1) return null;

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaping = false;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];

        if (inLineComment) {
            if (char === '\n') inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inSingle) {
            if (!escaping && char === '\'') inSingle = false;
            escaping = char === '\\' && !escaping;
            continue;
        }

        if (inDouble) {
            if (!escaping && char === '"') inDouble = false;
            escaping = char === '\\' && !escaping;
            continue;
        }

        if (inTemplate) {
            if (!escaping && char === '`') inTemplate = false;
            escaping = char === '\\' && !escaping;
            continue;
        }

        escaping = false;

        if (char === '/' && next === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(openIndex, index + 1);
            }
        }
    }

    return null;
}

function extractDefaultsFromSource(source) {
    const objectLiteral = findBalancedObjectLiteral(source, 'defaults:');
    if (!objectLiteral) {
        throw new Error('Could not find settings defaults in source');
    }

    // Node-only build/test helper. Runtime code must not use dynamic evaluation.
    const defaults = Function('"use strict"; return (' + objectLiteral + ');')();
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
        throw new Error('Parsed defaults are not a plain object');
    }

    return defaults;
}

function extractSettingsVersionFromSource(source) {
    const settingsVersionMatch = source.match(/SETTINGS_VERSION:\s*(\d+)/);
    if (!settingsVersionMatch) {
        throw new Error('Could not find settings version in source');
    }
    return Number(settingsVersionMatch[1]);
}

module.exports = {
    extractDefaultsFromSource,
    extractSettingsVersionFromSource,
    findBalancedObjectLiteral
};
