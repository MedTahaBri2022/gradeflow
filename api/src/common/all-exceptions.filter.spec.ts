import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter, ErrorBody } from './all-exceptions.filter';

function run(exception: unknown): ErrorBody {
  let body: ErrorBody | undefined;
  const response = {
    status: () => response,
    json: (payload: ErrorBody) => {
      body = payload;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/api/things' }),
    }),
  } as unknown as ArgumentsHost;

  const filter = new AllExceptionsFilter();
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return body as ErrorBody;
}

describe('AllExceptionsFilter', () => {
  it('keeps the status and message of HTTP exceptions', () => {
    expect(run(new NotFoundException('Course not found'))).toMatchObject({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Course not found',
      path: '/api/things',
    });
  });

  it('maps a unique violation to 409', () => {
    const error = new QueryFailedError('INSERT', [], {
      code: '23505',
    } as unknown as Error);
    expect(run(error).statusCode).toBe(409);
  });

  it('hides the details of unexpected errors', () => {
    const body = run(new Error('connection string postgres://user:pw@host'));
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
  });
});
