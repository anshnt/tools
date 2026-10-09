// Pack dev-utils: encoders, generators, regex, time and API helpers. Default category: dev.
export const cat = 'dev'
export default [
  { id: 'base64', name: 'Base64 encoder / decoder', desc: 'Encode and decode Base64 and Base64URL text (UTF-8 safe).', icon: 'binary', also: ['security'], tags: 'base64 encode decode' , ready: true },
  { id: 'url-encoder', name: 'URL encoder / decoder', desc: 'Percent-encode and decode URLs and query values.', icon: 'link', also: ['security', 'web'], tags: 'url encode decode percent' },
  { id: 'jwt-decoder', name: 'JWT decoder', desc: 'Decode JWT header and payload, check expiry, verify HS256 signatures.', icon: 'key-round', also: ['security'], tags: 'jwt token decode' },
  { id: 'jwt-generator', name: 'JWT generator', module: 'jwt-decoder', params: { mode: 'generate' }, desc: 'Create and sign HS256/384/512 JWTs for testing.', icon: 'key-square', also: ['security'], tags: 'jwt sign create' },
  { id: 'regex-tester', name: 'Regex tester', desc: 'Test regular expressions with live highlighting, groups and replace.', icon: 'regex', tags: 'regex regexp test match' },
  { id: 'regex-generator', name: 'Regex generator', desc: 'Ready-made patterns for emails, phones, dates, PAN, GSTIN and more.', icon: 'wand-sparkles', tags: 'regex pattern library generate' },
  { id: 'regex-visualizer', name: 'Regex visualizer', desc: 'See a regular expression as a railroad diagram with explanations.', icon: 'git-branch', tags: 'regex diagram explain' },
  { id: 'uuid-generator', name: 'UUID generator', desc: 'UUID v4 and v7, ULID and NanoID in bulk.', icon: 'fingerprint', also: ['security'], tags: 'uuid guid ulid nanoid' },
  { id: 'timestamp-converter', name: 'Unix timestamp converter', desc: 'Convert Unix seconds/milliseconds to dates and back, in any time zone.', icon: 'clock-4', also: ['calc'], tags: 'epoch unix timestamp date' },
  { id: 'cron-generator', name: 'Cron expression generator', desc: 'Build cron schedules, read them in plain English and see next runs.', icon: 'calendar-clock', tags: 'cron crontab schedule' },
  { id: 'cron-calculator', name: 'Cron schedule calculator', module: 'cron-generator', params: { mode: 'explain' }, desc: 'Paste a cron expression to explain it and list upcoming runs.', icon: 'calendar-clock', tags: 'cron next run explain' },
  { id: 'color-converter', name: 'Color converter', desc: 'HEX, RGB, HSL, HSV, CMYK and OKLCH, plus contrast checking.', icon: 'palette', also: ['image'], tags: 'hex rgb hsl cmyk color contrast' },
  { id: 'gradient-generator', name: 'CSS gradient generator', desc: 'Design linear and radial gradients and copy the CSS.', icon: 'paintbrush', tags: 'css gradient background' },
  { id: 'number-base-converter', name: 'Number base converter', desc: 'Binary, octal, decimal, hex and any base up to 36.', icon: 'binary', also: ['calc'], tags: 'binary hex octal decimal' },
  { id: 'api-tester', name: 'API tester', desc: 'Send HTTP requests with headers and body and inspect the response.', icon: 'send', mode: 'online', tags: 'rest api postman http request' },
  { id: 'curl-generator', name: 'cURL generator & converter', desc: 'Build cURL commands, or convert cURL to fetch, Python and more.', icon: 'terminal', tags: 'curl fetch convert request' },
  { id: 'http-status-codes', name: 'HTTP status codes', desc: 'Every HTTP status code explained, searchable.', icon: 'list', also: ['web'], tags: '404 500 status reference' },
  { id: 'mime-types', name: 'MIME type lookup', desc: 'Find the MIME type for an extension and the reverse.', icon: 'file-type', also: ['files'], tags: 'mime content type extension' },
  { id: 'unicode-lookup', name: 'Unicode character lookup', desc: 'Search characters and emoji; see code points and escapes.', icon: 'languages', also: ['text'], tags: 'unicode emoji character code point' },
  { id: 'chmod-calculator', name: 'chmod calculator', desc: 'Convert Unix file permissions between rwx and octal.', icon: 'square-terminal', tags: 'chmod permissions linux' },
]
