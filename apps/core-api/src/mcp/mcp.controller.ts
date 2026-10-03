import {
  All,
  Controller,
  NotFoundException,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { assertMcpTenantAccess } from './mcp.authorization.js';
import { isMcpServerEnabled } from './mcp.config.js';
import { McpSessionService } from './mcp-session.service.js';

type McpRequest = Request & { user?: AuthenticatedUser; body?: unknown };

@Controller('mcp')
export class McpController {
  constructor(
    private readonly authService: AuthService,
    private readonly mcpSessions: McpSessionService,
  ) {}

  @All()
  async handleMcp(@Req() req: McpRequest, @Res() res: Response): Promise<void> {
    if (!isMcpServerEnabled()) {
      throw new NotFoundException();
    }

    const user = await this.resolveUser(req);
    assertMcpTenantAccess(user);

    await this.mcpSessions.handleHttpRequest(req, res, req.body, user);
  }

  private async resolveUser(req: McpRequest): Promise<AuthenticatedUser> {
    if (req.user?.tenantId) {
      return req.user;
    }

    const authorization = req.headers.authorization;
    if (!authorization) {
      throw new UnauthorizedException();
    }

    const user = await this.authService.authenticateBearerToken(authorization);
    req.user = user;
    return user;
  }
}
