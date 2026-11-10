import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { EndedSessionLineageService } from './ended-session-lineage.service.js';
import { ScopeContextEchoInterceptor } from './scope-context-echo.interceptor.js';
import { ScopeContextResponseHeadersInterceptor } from './scope-context-response-headers.interceptor.js';
import {
  FirebaseScopeContextIdpAdapter,
  SCOPE_CONTEXT_IDP_PORT,
  TestScopeContextIdpAdapter,
} from './scope-context-idp.port.js';
import { ScopeContextLogoutService } from './scope-context-logout.service.js';
import { ScopeContextService } from './scope-context.service.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    ScopeContextService,
    ScopeContextLogoutService,
    EndedSessionLineageService,
    ScopeContextEchoInterceptor,
    ScopeContextResponseHeadersInterceptor,
    FirebaseScopeContextIdpAdapter,
    TestScopeContextIdpAdapter,
    {
      provide: SCOPE_CONTEXT_IDP_PORT,
      useFactory: (jwtService: JwtService) =>
        process.env.NODE_ENV === 'test'
          ? new TestScopeContextIdpAdapter(jwtService)
          : new FirebaseScopeContextIdpAdapter(),
      inject: [JwtService],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ScopeContextEchoInterceptor,
    },
  ],
  exports: [ScopeContextService, ScopeContextLogoutService],
})
export class ScopeContextModule {}
