import { toErrorPayload } from './errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export function toolSuccess(data: unknown, summary?: string): CallToolResult {
    return {
        content: [{ type: 'text', text: summary ?? JSON.stringify(data) }],
        structuredContent: toStructuredContent(data)
    };
}
export function toolFailure(error: unknown): CallToolResult {
    const payload = { error: toErrorPayload(error) };
    return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload
    };
}
function toStructuredContent(data: unknown): Record<string, unknown> {
    if (Array.isArray(data)) return { items: data };
    if (typeof data === 'object' && data !== null) return data as Record<string, unknown>;
    return { result: data };
}
