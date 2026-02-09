import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for the Public decorator.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark a route or controller as public (bypassing global AuthGuard).
 *
 * @returns {CustomDecorator} The decorator.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
