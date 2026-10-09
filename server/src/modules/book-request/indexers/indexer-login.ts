import type { PluginLoginFailure } from '@bookorbit/plugin-api';
import type { IndexerErrorCode } from '@bookorbit/types';

export const LOGIN_FAILURES: Record<PluginLoginFailure, { errorCode: IndexerErrorCode; message: string }> = {
  unauthorized: { errorCode: 'INDEXER_LOGIN_UNAUTHORIZED', message: 'The provider refused sign-in. Check your username/email and password.' },
  challenge: {
    errorCode: 'INDEXER_LOGIN_CHALLENGE',
    message: 'The provider requires a browser challenge. Complete it with the provider and use manual Session ID setup.',
  },
  twoFactorRequired: {
    errorCode: 'INDEXER_LOGIN_TWO_FACTOR_REQUIRED',
    message: 'The provider requires two-factor verification. Complete it with the provider and use manual Session ID setup.',
  },
  throttled: { errorCode: 'INDEXER_LOGIN_THROTTLED', message: 'The provider rate-limited sign-in. Try later.' },
  timeout: { errorCode: 'INDEXER_LOGIN_TIMEOUT', message: 'Indexer sign-in did not finish in time.' },
  unreachable: { errorCode: 'INDEXER_LOGIN_UNREACHABLE', message: 'The configured provider could not be reached.' },
  error: { errorCode: 'INDEXER_LOGIN_FAILED', message: 'Indexer sign-in failed.' },
};

export class IndexerLoginException extends Error {
  constructor(readonly failure: PluginLoginFailure) {
    super(LOGIN_FAILURES[failure].message);
    this.name = 'IndexerLoginException';
  }
}
