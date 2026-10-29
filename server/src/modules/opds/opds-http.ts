import type { FastifyInstance } from 'fastify';

export const AUTHENTICATION_HREF = '/api/v1/opds/authentication';
export function opdsAuthenticationDocument() {
  return {
    id: 'urn:bookorbit:authentication',
    title: 'Bookorbit',
    authentication: [{ type: 'http://opds-spec.org/auth/basic', labels: { login: 'Username', password: 'Password' } }],
  };
}

export function registerOpdsProgressionHttp(fastify: FastifyInstance) {
  if (!fastify.hasContentTypeParser('application/opds-progression+json')) {
    fastify.addContentTypeParser(
      'application/opds-progression+json',
      { parseAs: 'string', bodyLimit: 32768 },
      fastify.getDefaultJsonParser('error', 'error'),
    );
  }
  // Parser errors occur before Nest's controller filters, but still need draft-compatible payloads.
  fastify.addHook('onSend', (request, reply, payload, done) => {
    if (!request.routeOptions.url?.endsWith('/opds/:bookId/progression') || reply.statusCode < 400) return done(null, payload);
    if (reply.statusCode === 401) {
      reply.type('application/opds-authentication+json').header('Cache-Control', 'no-store');
      return done(null, JSON.stringify(opdsAuthenticationDocument()));
    }
    if (typeof payload !== 'string') return done(null, payload);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return done(null, payload);
    }
    if (typeof body.type !== 'string' || typeof body.title !== 'string')
      body = {
        type: 'https://registry.opds.io/error#progression-invalid-payload',
        title: 'Progression could not be updated due to an invalid payload.',
      };
    reply.type('application/problem+json').header('Cache-Control', 'no-store');
    return done(null, JSON.stringify(body));
  });
}
