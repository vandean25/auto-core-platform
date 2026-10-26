import {
  CanActivate,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isSchedulerModeHttp } from './scheduler-mode.js';

@Injectable()
export class HttpCronModeGuard implements CanActivate {
  canActivate(): boolean {
    if (!isSchedulerModeHttp()) {
      throw new NotFoundException();
    }
    return true;
  }
}
