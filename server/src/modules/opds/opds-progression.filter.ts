import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { opdsAuthenticationDocument } from './opds-http';
import type { FastifyReply } from 'fastify';

@Catch(HttpException)
export class OpdsProgressionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status = exception.getStatus();
    reply.header('Cache-Control', 'no-store');
    if (status === 401) return reply.status(status).type('application/opds-authentication+json').send(opdsAuthenticationDocument());
    const body = exception.getResponse();
    const problem =
      typeof body === 'object' && 'type' in body
        ? body
        : {
            type: `https://registry.opds.io/error#${status === 400 ? 'progression-invalid-payload' : status === 403 ? 'progression-incorrect-user' : 'progression-error'}`,
            title: exception.message,
          };
    return reply.status(status).type('application/problem+json').send(problem);
  }
}
