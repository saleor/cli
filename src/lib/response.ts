import { HTTPError } from 'got';

export const isNotFound = (error: unknown) => {
  if (error instanceof HTTPError) {
    const { statusCode } = error.response;

    if (statusCode === 404) return true;
  }

  return false;
};

export default isNotFound;
