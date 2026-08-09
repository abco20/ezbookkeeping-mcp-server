export class AppError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly status: number | undefined;
    readonly details: unknown;
    readonly upstreamErrorCode: string | number | undefined;
    readonly requestId: string | undefined;
    constructor(code: string, message: string, options: { cause?: unknown; retryable?: boolean; status?: number; details?: unknown; upstreamErrorCode?: string | number; requestId?: string } = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'AppError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.status = options.status;
        this.details = options.details;
        this.upstreamErrorCode = options.upstreamErrorCode;
        this.requestId = options.requestId;
    }
}
export function assert(condition: unknown, code: string, message: string, details: unknown = undefined): asserts condition {
    if (!condition)
        throw new AppError(code, message, { details });
}
export function toErrorPayload(error: unknown) {
    const appError = normalizeError(error);
    return {
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
        ...(appError.details !== undefined ? { details: appError.details } : {}),
        ...(appError.upstreamErrorCode !== undefined ? { upstream_error_code: appError.upstreamErrorCode } : {}),
        ...(appError.requestId ? { request_id: appError.requestId } : {})
    };
}
export function normalizeError(error: unknown): AppError {
    if (error instanceof AppError)
        return error;
    if (error instanceof Error) {
        return new AppError('INTERNAL_ERROR', error.message, { cause: error });
    }
    return new AppError('INTERNAL_ERROR', String(error));
}
