import type { IBasemapManagementEnv } from '@common/env';

type AccessTokenConfig = IBasemapManagementEnv['accessToken'];
type ExposureType = IBasemapManagementEnv['mapServer']['exposureType'];

const REDACTED = '[REDACTED]';

export type TokenInjection = 'header' | 'queryParam' | 'none';

export function getTokenInjection(exposureType: ExposureType, accessToken: AccessTokenConfig): TokenInjection {
  if (exposureType !== 'ROUTE' || accessToken.tokenValue === '') {
    return 'none';
  }
  const injectionType = accessToken.injectionType.toLowerCase();
  if (injectionType === 'header') {
    return 'header';
  }
  return injectionType === 'queryparam' ? 'queryParam' : 'none';
}

export function withTokenQueryParam(url: string, accessToken: AccessTokenConfig): string {
  const parsed = new URL(url);
  parsed.searchParams.set(accessToken.attributeName, accessToken.tokenValue);
  return parsed.toString();
}

export function createRedactor(injection: TokenInjection, accessToken: AccessTokenConfig): (value: string) => string {
  if (injection === 'none') {
    return (value) => value;
  }
  const secret = accessToken.tokenValue;
  const encoded = encodeURIComponent(secret);
  return (value) => value.split(secret).join(REDACTED).split(encoded).join(REDACTED);
}

export { REDACTED };
