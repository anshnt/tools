// Pack security: passwords, hashing, encryption and privacy. Default category: security.
export const cat = 'security'
export default [
  { id: 'password-generator', name: 'Password generator', desc: 'Strong random passwords with length and character options.', icon: 'key-round', tags: 'password random strong', ready: true },
  { id: 'passphrase-generator', name: 'Passphrase generator', desc: 'Memorable multi-word passphrases (diceware style).', icon: 'key', tags: 'passphrase diceware words', ready: true },
  { id: 'password-strength', name: 'Password strength checker', desc: 'Estimate crack time, entropy and weaknesses. Nothing leaves your device.', icon: 'shield', tags: 'strength entropy crack time', ready: true },
  { id: 'password-entropy', name: 'Password entropy calculator', module: 'password-strength', params: { focus: 'entropy' }, desc: 'Bits of entropy for a password or a generation policy.', icon: 'sigma', tags: 'entropy bits', ready: true },
  { id: 'random-string', name: 'Secure random string', desc: 'Cryptographically random strings, tokens and API-key-like values.', icon: 'shuffle', also: ['dev'], tags: 'random token string secret', ready: true },
  { id: 'random-number', name: 'Random number generator', desc: 'Secure random numbers in a range, with no repeats option.', icon: 'dices', also: ['personal'], tags: 'random number lottery', ready: true },
  { id: 'hash-generator', name: 'Hash generator', desc: 'MD5, SHA-1, SHA-256, SHA-512, SHA-3 and BLAKE hashes of text or files.', icon: 'fingerprint', also: ['dev'], tags: 'hash md5 sha256 checksum', ready: true },
  { id: 'sha256-generator', name: 'SHA-256 generator', module: 'hash-generator', params: { algo: 'sha256' }, desc: 'SHA-256 hash of text or a file.', icon: 'fingerprint', tags: 'sha256', ready: true },
  { id: 'md5-generator', name: 'MD5 generator', module: 'hash-generator', params: { algo: 'md5' }, desc: 'MD5 hash of text or a file.', icon: 'fingerprint', tags: 'md5', ready: true },
  { id: 'hmac-generator', name: 'HMAC generator', desc: 'HMAC-SHA256/384/512 signatures with a secret key.', icon: 'key-square', also: ['dev'], tags: 'hmac signature webhook', ready: true },
  { id: 'file-checksum', name: 'File checksum', desc: 'Verify downloads with MD5, SHA-1, SHA-256 or CRC32 checksums.', icon: 'file-check', also: ['files'], tags: 'checksum verify integrity', ready: true },
  { id: 'encrypt-text', name: 'Encrypt / decrypt text', desc: 'AES-256 encrypt text with a password; decrypt it anywhere with this tool.', icon: 'lock-keyhole', tags: 'aes encrypt decrypt password', ready: true },
  { id: 'secret-message', name: 'Secret message encoder', desc: 'Hide a message inside normal text or an image (steganography).', icon: 'venetian-mask', tags: 'steganography hidden message zero width', ready: true },
  { id: 'pii-redactor', name: 'PII detector & redactor', desc: 'Find and mask emails, phones, Aadhaar, PAN, cards and more in text.', icon: 'scan-eye', also: ['india'], tags: 'pii redact mask privacy aadhaar pan' },
  { id: 'office-metadata-remover', name: 'Office metadata remover', desc: 'Strip author, company and history from .docx, .xlsx and .pptx.', icon: 'file-x', tags: 'docx xlsx pptx metadata author' },
  { id: 'totp-generator', name: '2FA code generator (TOTP)', desc: 'Generate time-based 2FA codes from a secret key, offline.', icon: 'smartphone', tags: '2fa totp authenticator otp', ready: true },
  { id: 'bcrypt-generator', name: 'Bcrypt hash & verify', desc: 'Hash passwords with bcrypt and check a password against a hash.', icon: 'hash', also: ['dev'], tags: 'bcrypt password hash', ready: true },
]
