"""Authentication constants (Chapter 07). These values come from the specification."""

ACCESS_TOKEN_MINUTES = 30  # access token lifetime
REFRESH_TOKEN_DAYS = 7  # refresh token lifetime
CCCD_RETENTION_DAYS = 180  # how long an owner's CCCD is kept before it is auto-hidden

ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/admin/auth"  # the refresh cookie is only sent to the auth endpoints

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "explanatory-notes-auto"
JWT_LEEWAY_SECONDS = 10
