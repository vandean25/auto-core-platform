import { Injectable } from '@nestjs/common';
import { SiteServiceRuntime } from './site.runtime.js';

/** Stable Nest entry path; facade wiring lives in site.runtime.ts */
@Injectable()
export class SiteService extends SiteServiceRuntime {}
