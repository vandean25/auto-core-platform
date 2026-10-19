import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('AppModule bootstrap (AUT-612)', () => {
  it('compiles with McpModule weekly and media MCP wiring', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();
  });
});
