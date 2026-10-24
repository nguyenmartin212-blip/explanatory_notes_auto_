// Authentication constants (Chapter 07). These values come from the specification.
export const ACCESS_TOKEN_MINUTES = 30; // access token lifetime
export const REFRESH_TOKEN_DAYS = 7; // refresh token lifetime

export const ACCESS_COOKIE_NAME = 'access_token';
export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/admin/auth'; // the refresh cookie is only sent to the auth endpoints

export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'explanatory-notes-auto';
export const JWT_LEEWAY_SECONDS = 10;
