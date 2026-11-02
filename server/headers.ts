const FONT_SHEETS = 'https://fonts.googleapis.com';
const FONT_FILES = 'https://fonts.gstatic.com';

/**
 * Sent with everything the production server answers. Scripts come from this server only, so text in a design can't
 * run even if it ever reached the page as markup. Styles allow inline ones for React Flow's positioning; picture
 * export fetches the fonts and draws through data: and blob: images.
 */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' 'unsafe-inline' ${FONT_SHEETS}`,
    `font-src 'self' data: ${FONT_FILES}`,
    "img-src 'self' data: blob:",
    `connect-src 'self' ${FONT_SHEETS} ${FONT_FILES}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
