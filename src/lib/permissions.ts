import type { WriteProfile } from '../types.js';
import { AppError } from './errors.js';

const LEVEL = { read: 0, standard: 1, extended: 2, admin: 3 } as const;

function levelFor(profile: string): number {
    return LEVEL[profile as keyof typeof LEVEL] ?? -1;
}

export function requireProfile(current: WriteProfile, required: WriteProfile, operation: string): void {
    const currentLevel = levelFor(current);
    const requiredLevel = levelFor(required);
    if (currentLevel < 0 || requiredLevel < 0)
        throw new AppError('INVALID_WRITE_PROFILE', `Unknown write profile: ${current}`);
    if (currentLevel < requiredLevel) {
        throw new AppError('WRITE_NOT_ALLOWED', `${operation} requires the ${required} profile`, {
            details: { current_profile: current, required_profile: required }
        });
    }
}

export function capabilitiesForProfile(profile: WriteProfile) {
    const level = levelFor(profile);
    return {
        profile,
        read: true,
        transaction_write: level >= LEVEL.standard,
        master_write: level >= LEVEL.extended,
        destructive_admin: level >= LEVEL.admin
    };
}
