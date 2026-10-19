import { Injectable } from '@nestjs/common';
import { SiteServiceRuntime } from './site.runtime.js';

/** Stable Nest entry path; facade wiring lives in site.runtime.ts for repowise. */
@Injectable()
export class SiteService extends SiteServiceRuntime {}
