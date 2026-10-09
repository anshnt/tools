// Library of ready-made regular expressions with examples. Every pattern is covered by a test in the PR (valid ones match, invalid ones do not).
// kind 'validate': anchored, the whole string must match. kind 'find': pulls pieces out of longer text (text + expected matches).

export const CATS = [
  { id: 'web', name: 'Web & internet', icon: 'globe' },
  { id: 'phone', name: 'Phone numbers', icon: 'phone' },
  { id: 'india', name: 'India', icon: 'landmark' },
  { id: 'dates', name: 'Dates & times', icon: 'calendar' },
  { id: 'numbers', name: 'Numbers, money & IDs', icon: 'hash' },
  { id: 'text', name: 'Text', icon: 'type' },
  { id: 'dev', name: 'Developer', icon: 'code' },
]

const v = (id, name, cat, pattern, desc, valid, invalid, flags = '') => ({ id, name, cat, pattern, flags, desc, kind: 'validate', valid, invalid })
const f = (id, name, cat, pattern, flags, desc, text, matches) => ({ id, name, cat, pattern, flags, desc, kind: 'find', text, matches })
const R = String.raw

export const PATTERNS = [
  // ---- Web ----
  v('email', 'Email address', 'web', R`^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$`, 'A practical email check: name, @, domain and a 2+ letter ending.',
    ['asha@example.com', 'first.last+news@mail.example.co.in', 'a_b-c@sub.domain.org'], ['plainaddress', '@example.com', 'asha@example', 'asha@@example.com', 'asha@exa..mple.com']),
  v('url', 'URL (http / https)', 'web', R`^https?:\/\/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d{2,5})?(?:[\/?#][^\s]*)?$`, 'Web addresses that start with http:// or https://, optional port, path, query and fragment.',
    ['https://example.com', 'http://www.example.co.uk/path/to?x=1&y=2#top', 'https://api.example.com:8443/v1/items'], ['example.com', 'ftp://example.com', 'https://', 'http://exa mple.com']),
  v('domain', 'Domain name', 'web', R`^(?!-)(?:[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$`, 'A hostname such as example.com or sub.example.co.uk (labels cannot start or end with a hyphen).',
    ['example.com', 'sub.example.co.uk', 'my-site.dev'], ['-example.com', 'example-.com', 'example', 'exa mple.com']),
  v('ipv4', 'IPv4 address', 'web', R`^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$`, 'Four numbers from 0 to 255 separated by dots.',
    ['192.168.1.1', '0.0.0.0', '255.255.255.255', '10.0.0.254'], ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4']),
  v('ipv6', 'IPv6 address', 'web', R`^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:))$`, 'Full and compressed (::) IPv6 addresses.',
    ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', '::1', 'fe80::1', '2001:db8::ff00:42:8329', '::'], ['2001:db8:::1', '12345::1', 'gggg::1', '1:2:3:4:5:6:7:8:9']),
  v('mac', 'MAC address', 'web', R`^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$`, 'Six hex pairs separated by colons or hyphens.',
    ['00:1A:2B:3C:4D:5E', 'aa-bb-cc-dd-ee-ff'], ['00:1A:2B:3C:4D', '00:1A:2B:3C:4D:5G', '001A.2B3C.4D5E']),
  v('port', 'Network port (0-65535)', 'web', R`^(?:6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]\d{4}|[1-9]\d{0,3}|0)$`, 'A valid TCP/UDP port number.',
    ['80', '443', '8080', '65535', '0'], ['65536', '-1', '08080', 'http']),
  v('slug', 'URL slug', 'web', R`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 'Lowercase words joined by single hyphens, like my-blog-post.',
    ['my-blog-post', 'tools-2026', 'hello'], ['My-Post', 'double--hyphen', '-leading', 'trailing-', 'with space']),
  v('username', 'Username', 'web', R`^[a-zA-Z][a-zA-Z0-9_]{2,15}$`, '3 to 16 characters: starts with a letter, then letters, digits or underscores.',
    ['ansh_99', 'Dev', 'user_name_1'], ['1user', 'ab', 'has space', 'waytoolongusername_12345']),
  f('hashtag', 'Hashtags', 'web', R`#[\p{L}\p{M}\p{N}_]+`, 'gu', 'Finds #hashtags in any language.', 'Loving the #monsoon in #Mumbai! #\u0939\u093f\u0928\u094d\u0926\u0940 # not one', ['#monsoon', '#Mumbai', '#\u0939\u093f\u0928\u094d\u0926\u0940']),
  f('mention', '@mentions', 'web', R`(?<![\w@])@[A-Za-z0-9_]{1,15}\b`, 'g', 'Finds @username mentions (not email addresses).', 'Thanks @asha_dev and @bob! mail me@site.com', ['@asha_dev', '@bob']),
  f('emails-in-text', 'Emails in text', 'web', R`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`, 'g', 'Pulls every email address out of a block of text.', 'Write to hi@example.com or sales@shop.co.in, not @home.', ['hi@example.com', 'sales@shop.co.in']),
  f('urls-in-text', 'URLs in text', 'web', R`https?:\/\/[^\s<>"')]+`, 'g', 'Finds http and https links inside text, stopping at spaces and closing quotes or brackets.', 'See https://example.com/a?b=1 and (http://x.org/p) now.', ['https://example.com/a?b=1', 'http://x.org/p']),
  f('youtube', 'YouTube video ID', 'web', R`(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})`, 'g', 'Captures the 11-character video ID from watch, short, embed and youtu.be links.', 'https://youtu.be/dQw4w9WgXcQ and https://www.youtube.com/watch?v=aqz-KE-bpKQ', ['youtu.be/dQw4w9WgXcQ', 'youtube.com/watch?v=aqz-KE-bpKQ']),
  f('markdown-link', 'Markdown links', 'web', R`\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)`, 'g', 'Captures the text and the URL of [text](url) links.', 'Read [the docs](https://a.dev/docs) or [home](/ "Home").', ['[the docs](https://a.dev/docs)', '[home](/ "Home")']),
  v('data-uri', 'Base64 data URI', 'web', R`^data:[\w.+-]+\/[\w.+-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+\/]+={0,2}$`, 'data: URLs with base64 content, such as inline images.',
    ['data:image/png;base64,iVBORw0KGgo=', 'data:text/plain;charset=utf-8;base64,SGVsbG8='], ['data:image/png,abc', 'image/png;base64,abc', 'data:;base64,SGk=']),
  // ---- Phone ----
  v('phone-in', 'India mobile number', 'phone', R`^(?:\+91[\s-]?|91[\s-]?|0)?[6-9]\d{9}$`, '10-digit Indian mobiles starting 6-9, with optional +91, 91 or 0 prefix.',
    ['9876543210', '+91 9876543210', '+91-9876543210', '09876543210', '919876543210'], ['1234567890', '98765432', '+91 5876543210', '98765432101']),
  v('phone-in-landline', 'India landline (with STD)', 'phone', R`^0\d{2,4}[\s-]?\d{6,8}$`, 'STD code starting with 0, then 6-8 digits, for example 011-23456789.',
    ['011-23456789', '022 12345678', '04427654321'], ['23456789', '9876543210', '011-123']),
  v('phone-us', 'US / Canada phone', 'phone', R`^(?:\+1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}$`, 'NANP numbers: area code and exchange cannot start with 0 or 1.',
    ['(212) 555-0123', '212-555-0123', '+1 212 555 0123', '2125550123', '212.555.0123'], ['123-456-7890', '212-055-0123', '555-0123', '+44 20 7946 0958']),
  v('phone-e164', 'International phone (E.164)', 'phone', R`^\+[1-9]\d{6,14}$`, 'Plus sign, country code and number, 7 to 15 digits in total, no spaces.',
    ['+919876543210', '+14155552671', '+442071838750'], ['919876543210', '+0123456789', '+91 98765 43210', '+12345']),
  v('phone-intl', 'International phone (loose)', 'phone', R`^(?=(?:\D*\d){8,15}$)\+?\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}$`, 'Accepts spaces, dots, hyphens and brackets between groups.',
    ['+44 20 7946 0958', '+91 98765 43210', '+1 (415) 555-2671', '+49 30 901820'], ['hello', '12', '+', '+44 20 79']),
  v('phone-uk-mobile', 'UK mobile number', 'phone', R`^(?:\+44\s?7\d{3}|07\d{3})\s?\d{6}$`, 'UK mobile numbers that start 07 or +44 7.',
    ['07911 123456', '+44 7911 123456', '07911123456'], ['01234 567890', '+44 8911 123456', '0791112345']),
  // ---- India ----
  v('pin-in', 'PIN code (India)', 'india', R`^[1-9]\d{2}\s?\d{3}$`, '6-digit postal PIN that does not start with 0; one optional space is allowed in the middle.',
    ['560001', '110 011', '400001'], ['060001', '56001', '5600011', 'ABC123']),
  v('pan', 'PAN card', 'india', R`^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$`, 'Permanent Account Number: 5 letters (4th is the holder type), 4 digits, 1 letter.',
    ['AAAPL1234C', 'BNZPM2501F', 'AAACR5055K'], ['abcpe1234f', 'AAAZL1234C', 'AAAPL12345', 'AAAPL1234']),
  v('gstin', 'GSTIN', 'india', R`^(?:0[1-9]|[12]\d|3[0-8])[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, '15-character GST number: state code, PAN, entity number, Z and a check character.',
    ['27AAPFU0939F1ZV', '07AABCU9603R1ZX', '29ABCDE1234F1Z5'], ['27AAPFU0939F1ZVX', '99AAPFU0939F1ZV', '27AAPFU0939F1AV', '27aapfu0939f1zv']),
  v('aadhaar', 'Aadhaar number', 'india', R`^[2-9]\d{3}\s?\d{4}\s?\d{4}$`, '12 digits, first digit 2-9, optionally grouped 4-4-4. Format only: it does not run the Verhoeff check.',
    ['2345 6789 0123', '234567890123', '9876 5432 1098'], ['0123 4567 8901', '1234 5678 9012', '2345 6789 012', '2345-6789-0123']),
  v('ifsc', 'IFSC code', 'india', R`^[A-Z]{4}0[A-Z0-9]{6}$`, 'Bank branch code: 4 letters, a zero, then 6 letters or digits.',
    ['SBIN0001234', 'HDFC0000123', 'ICIC0001A23'], ['SBIN1001234', 'SBI00001234', 'sbin0001234', 'SBIN000123']),
  v('vehicle-in', 'Vehicle number (India)', 'india', R`^(?:[A-Z]{2}[ -]?\d{1,2}[A-Z]?[ -]?[A-Z]{1,3}[ -]?\d{1,4}|\d{2}BH\d{4}[A-Z]{2})$`, 'State, RTO code, series letters and a number, with optional spaces or hyphens. Also the BH series.',
    ['MH12AB1234', 'DL8CAF5030', 'KA 01 AB 1234', 'MH-12-AB-1234', 'TN09A1234', '22BH1234AA'], ['1234', 'MH12', 'MH12AB12345', 'mh12ab1234']),
  v('passport-in', 'Passport number (India)', 'india', R`^[A-PR-WY][1-9]\d\s?\d{4}[1-9]$`, 'One letter followed by 7 digits, as on Indian passports.',
    ['A1234567', 'K2345678', 'J8369854'], ['A0123456', 'Q1234567', 'A123456', 'a1234567']),
  v('voter-id', 'Voter ID (EPIC)', 'india', R`^[A-Z]{3}\d{7}$`, 'Election photo ID: 3 letters then 7 digits.',
    ['ABC1234567', 'XYZ9876543'], ['AB12345678', 'ABC123456', 'abc1234567']),
  v('dl-in', 'Driving licence (India)', 'india', R`^[A-Z]{2}[ -]?\d{2}[ -]?(?:19|20)\d{2}[ -]?\d{7}$`, 'State code, RTO code, year of issue and a 7-digit serial.',
    ['MH1220150123456', 'DL-04-2011-0012345', 'KA 01 2019 1234567'], ['MH12201501234', 'XX1230150123456', '1220150123456']),
  v('upi', 'UPI ID', 'india', R`^[A-Za-z0-9.\-_]{2,256}@[A-Za-z]{2,64}$`, 'A handle, @ and the bank or app handle, such as name@okaxis.',
    ['ansh@okaxis', '9876543210@ybl', 'first.last-1@paytm'], ['ansh@', '@upi', 'a@b', 'ansh okaxis']),
  v('tan', 'TAN', 'india', R`^[A-Z]{4}\d{5}[A-Z]$`, 'Tax Deduction Account Number: 4 letters, 5 digits, 1 letter.',
    ['DELA12345B', 'MUMB98765C'], ['DEL12345B', 'DELA1234B', 'dela12345b']),
  v('bank-account-in', 'Bank account number (India)', 'india', R`^\d{9,18}$`, 'Indian bank account numbers are 9 to 18 digits.',
    ['123456789', '123456789012345678', '000123456789'], ['12345678', '1234567890123456789', '1234 5678 9012']),
  v('inr-amount', 'Indian rupee amount', 'india', R`^(?:\u20b9\s?)?(?:\d{1,3}(?:,\d{2})*,\d{3}|\d+)(?:\.\d{1,2})?$`, 'Amounts with lakh/crore grouping (1,23,456.78) and an optional \u20b9 sign.',
    ['\u20b91,23,456.78', '12,34,56,789', '1,000', '999', '123456'], ['1,2345', '12,34,5678', '\u20b9', '1,23,45']),
  f('mobile-in-text', 'Indian mobiles in text', 'india', R`(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)`, 'g', 'Finds 10-digit Indian mobile numbers inside longer text.', 'Call +91 9876543210 or 8123456789 (not 1234567890 or 98765432101).', ['+91 9876543210', '8123456789']),
  // ---- Dates & times ----
  v('date-iso', 'Date (YYYY-MM-DD)', 'dates', R`^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$`, 'ISO 8601 calendar date. It checks the ranges, not whether the day exists in that month.',
    ['2026-10-09', '1999-01-31', '2024-02-29'], ['2026-13-01', '2026-00-10', '26-10-09', '2026/10/09']),
  v('date-dmy', 'Date (DD/MM/YYYY)', 'dates', R`^(?:0[1-9]|[12]\d|3[01])\/(?:0[1-9]|1[0-2])\/\d{4}$`, 'Day first, as used in India and Europe.',
    ['09/10/2026', '31/12/1999', '01/01/2000'], ['32/01/2026', '09/13/2026', '9/10/2026', '2026/10/09']),
  v('date-mdy', 'Date (MM/DD/YYYY)', 'dates', R`^(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/\d{4}$`, 'Month first, as used in the US.',
    ['10/09/2026', '12/31/1999'], ['13/01/2026', '10/32/2026', '1/5/2026']),
  v('date-flex', 'Date (DD-MM-YYYY, . or / too)', 'dates', R`^(?:0[1-9]|[12]\d|3[01])[-.\/](?:0[1-9]|1[0-2])[-.\/](?:19|20)\d{2}$`, 'Day-month-year with -, . or / as separators, years 1900-2099.',
    ['09-10-2026', '09.10.2026', '09/10/2026'], ['09-10-1850', '9-10-2026', '09_10_2026']),
  v('datetime-iso', 'ISO 8601 date and time', 'dates', R`^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$`, 'Timestamps like 2026-10-09T14:30:00Z or with an offset.',
    ['2026-10-09T14:30:00Z', '2026-10-09T14:30', '2026-10-09T14:30:15.123+05:30', '2026-10-09T23:59:59-0800'], ['2026-10-09 14:30:00', '2026-10-09T24:00:00Z', '2026-10-09T14:60']),
  v('time-24', 'Time (24-hour)', 'dates', R`^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$`, 'HH:MM or HH:MM:SS from 00:00 to 23:59:59.',
    ['00:00', '09:05', '23:59:59'], ['24:00', '9:05', '12:60', '12:5']),
  v('time-12', 'Time (12-hour)', 'dates', R`^(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM|am|pm)$`, 'Clock time with AM or PM.',
    ['9:05 AM', '12:00 pm', '01:30PM'], ['13:00 PM', '9:5 AM', '9:05', '0:30 AM']),
  v('year', 'Year (1900-2099)', 'dates', R`^(?:19|20)\d{2}$`, 'Four-digit year in the 20th and 21st century.',
    ['1900', '1999', '2026', '2099'], ['1899', '2100', '99', 'abcd']),
  v('duration-iso', 'ISO 8601 duration', 'dates', R`^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$`, 'Durations such as P3DT4H30M or PT45S.',
    ['P3D', 'PT45S', 'P1Y2M3DT4H5M6S', 'PT0.5S', 'P2W'], ['P', 'PT', '3D', 'P1H']),
  v('unix-ts', 'Unix timestamp', 'dates', R`^\d{10}(?:\d{3})?$`, 'Seconds (10 digits) or milliseconds (13 digits) since 1970.',
    ['1700000000', '1700000000123'], ['170000000', '17000000001234', '1.7e9']),
  // ---- Numbers, money, IDs ----
  v('integer', 'Integer', 'numbers', R`^[+-]?\d+$`, 'Whole numbers with an optional sign.', ['0', '42', '-17', '+8'], ['3.14', '1,000', '', '12a']),
  v('decimal', 'Decimal number', 'numbers', R`^[+-]?(?:\d+\.?\d*|\.\d+)$`, 'Integers and decimals such as 3.14, -0.5 or .75.', ['3.14', '-0.5', '.75', '10', '7.'], ['1.2.3', '--1', 'abc', '1,5']),
  v('positive-int', 'Positive integer', 'numbers', R`^[1-9]\d*$`, 'Whole numbers from 1 upward, without leading zeros.', ['1', '25', '1000'], ['0', '-5', '007', '1.5']),
  v('percentage', 'Percentage', 'numbers', R`^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$`, '0% to 100% with optional decimals.', ['0%', '45.5%', '100%', '99.99%'], ['101%', '-5%', '50', '5.%']),
  v('usd', 'US dollar amount', 'numbers', R`^\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?$`, 'Amounts like $1,234.56 with thousands commas and 2 decimals.', ['$1,234.56', '999', '$0.99', '1,000,000'], ['$1,23.45', '12.5', '$1234,567', '$']),
  v('scientific', 'Scientific notation', 'numbers', R`^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$`, 'Numbers like 6.022e23 or 1E-9.', ['6.022e23', '1E-9', '-3.5e+2'], ['1e', 'e5', '1.e5']),
  v('latitude', 'Latitude', 'numbers', R`^[+-]?(?:90(?:\.0+)?|[1-8]?\d(?:\.\d+)?)$`, 'Degrees from -90 to 90.', ['12.9716', '-33.8688', '90', '0'], ['90.5', '-91', 'abc']),
  v('longitude', 'Longitude', 'numbers', R`^[+-]?(?:180(?:\.0+)?|(?:1[0-7]\d|[1-9]?\d)(?:\.\d+)?)$`, 'Degrees from -180 to 180.', ['77.5946', '-122.4194', '180', '0'], ['180.5', '-181', '200']),
  v('hex-number', 'Hexadecimal number', 'numbers', R`^(?:0[xX])?[0-9a-fA-F]+$`, 'Hex digits with an optional 0x prefix.', ['ff', '0xDEADBEEF', '1A2b'], ['0xGG', 'xyz', '']),
  v('binary-number', 'Binary number', 'numbers', R`^[01]+$`, 'Only zeros and ones.', ['1010', '0', '11111111'], ['1012', '', 'abc']),
  v('roman', 'Roman numerals', 'numbers', R`^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$`, 'Roman numerals from I to MMMCMXCIX.', ['XIV', 'MMXXVI', 'IX', 'MCMXCIV'], ['IIII', 'VX', 'ABC', '']),
  v('credit-card', 'Credit card number', 'numbers', R`^(?:4\d{12}(?:\d{3})?|(?:5[1-5]\d{2}|2(?:2[2-9]\d|[3-6]\d{2}|7[01]\d|720))\d{12}|3[47]\d{13}|6(?:011|5\d{2})\d{12})$`, 'Visa, Mastercard, Amex and Discover number formats. Format only: use a Luhn check to catch typos.',
    ['4111111111111111', '5555555555554444', '378282246310005', '6011111111111117'], ['4111 1111 1111 1111', '1234567890123456', '41111111111111112']),
  v('card-spaced', 'Card number (grouped by 4)', 'numbers', R`^(?:\d{4}[ -]?){3}\d{4}$`, '16 digits, optionally in groups of four separated by a space or hyphen.', ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111111111111111'], ['4111 1111 1111', '4111  1111 1111 1111', '41111-1111-1111-1111']),
  v('card-expiry', 'Card expiry (MM/YY)', 'numbers', R`^(?:0[1-9]|1[0-2])\/\d{2}$`, 'Month and two-digit year.', ['01/28', '12/30'], ['13/28', '1/28', '01/2028']),
  v('cvv', 'CVV / CVC', 'numbers', R`^\d{3,4}$`, '3 digits (Visa, Mastercard) or 4 digits (Amex).', ['123', '4567'], ['12', '12345', 'abc']),
  v('zip-us', 'US ZIP code', 'numbers', R`^\d{5}(?:-\d{4})?$`, '5 digits with an optional +4 extension.', ['90210', '10001-1234'], ['9021', '90210-12', 'ABCDE']),
  v('postcode-uk', 'UK postcode', 'numbers', R`^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$`, 'Outward and inward code such as SW1A 1AA.', ['SW1A 1AA', 'M1 1AE', 'EC1A1BB'], ['12345', 'SW1A', 'sw1a 1aa'], ''),
  v('postal-ca', 'Canadian postal code', 'numbers', R`^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$`, 'Letter-digit-letter, then digit-letter-digit.', ['K1A 0B1', 'M5V-3L9', 'V6B1A1'], ['D1A 0B1', '12345', 'K1A0B']),
  v('ssn-us', 'US Social Security number', 'numbers', R`^(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}$`, 'AAA-GG-SSSS with the reserved ranges rejected.', ['123-45-6789', '078-05-1120'], ['000-12-3456', '666-12-3456', '123-00-4567', '123-45-0000', '123456789']),
  v('iban', 'IBAN (format)', 'numbers', R`^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$`, 'Country code, 2 check digits and up to 30 letters or digits. Does not verify the checksum.', ['GB82WEST12345698765432', 'DE89370400440532013000', 'FR1420041010050500013M02606'], ['gb82west12345698765432', 'GB82', '1234567890']),
  v('swift', 'SWIFT / BIC code', 'numbers', R`^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$`, '8 or 11 characters: bank, country, location and optional branch.', ['DEUTDEFF', 'CHASUS33XXX', 'SBININBB'], ['DEUTDEF', 'deutdeff', '12345678']),
  v('isbn13', 'ISBN-13', 'numbers', R`^(?=(?:\D*\d){13}$)97[89][- ]?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?\d$`, 'Book numbers starting 978 or 979, with optional hyphens or spaces.', ['978-3-16-148410-0', '9780306406157', '979 10 90636 07 1'], ['123-4-56-789012-3', '978-3-16', '97831614841']),
  v('btc', 'Bitcoin address', 'numbers', R`^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$`, 'Legacy (1..., 3...) and Bech32 (bc1...) formats. Does not verify the checksum.', ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'], ['0BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'bc2qar0srrr7xfk', '1Bv']),
  v('eth', 'Ethereum address', 'numbers', R`^0x[a-fA-F0-9]{40}$`, '0x followed by 40 hex digits.', ['0x742d35Cc6634C0532925a3b844Bc454e4438f44e', '0x0000000000000000000000000000000000000000'], ['0x742d35Cc6634C0532925a3b844Bc454e4438f44', '742d35Cc6634C0532925a3b844Bc454e4438f44e', '0xZZ2d35Cc6634C0532925a3b844Bc454e4438f44e']),
  f('numbers-in-text', 'Numbers in text', 'numbers', R`-?\d+(?:\.\d+)?`, 'g', 'Finds integers and decimals, with a leading minus sign.', 'Paid 12.50 for 3 items, change -4 and 0.25.', ['12.50', '3', '-4', '0.25']),
  // ---- Text ----
  v('strong-password', 'Strong password', 'text', R`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$`, 'At least 8 characters with a lowercase letter, an uppercase letter, a digit and a symbol.', ['Passw0rd!', 'C0rrect-Horse', 'Tr0ub4dor&3'], ['password', 'PASSWORD1!', 'Short1!', 'NoDigits!!']),
  v('letters-only', 'Letters only', 'text', R`^[A-Za-z]+$`, 'A to Z, either case, nothing else.', ['Hello', 'abc'], ['Hello World', 'abc123', '']),
  v('alphanumeric', 'Letters and digits', 'text', R`^[A-Za-z0-9]+$`, 'No spaces or symbols.', ['abc123', 'ABC', '42'], ['abc 123', 'abc_123', '']),
  v('person-name', 'Person name', 'text', R`^[\p{L}\p{M}]+(?:[ '\u2019.-][\p{L}\p{M}]+)*$`, 'Letters from any language with single spaces, hyphens, apostrophes or dots between words.', ['Asha Verma', "O'Connor", 'Jean-Luc', '\u0905\u0936\u094b\u0915 \u0915\u0941\u092e\u093e\u0930'], ['Asha  Verma', 'R2D2', '-Asha', ''], 'u'),
  v('no-whitespace', 'No whitespace', 'text', R`^\S+$`, 'At least one character and no spaces, tabs or line breaks.', ['no-spaces-here', 'x'], ['has space', 'tab\there', '']),
  f('extra-spaces', 'Repeated spaces', 'text', R`[ \t]{2,}`, 'g', 'Finds runs of two or more spaces or tabs, handy for clean-up with Replace.', 'Too   many    spaces here', ['   ', '    ']),
  f('trim-ends', 'Leading and trailing whitespace', 'text', R`^\s+|\s+$`, 'g', 'Matches whitespace at the start and end of the text (replace with nothing to trim).', '   padded text   ', ['   ', '   ']),
  f('repeated-words', 'Repeated words', 'text', R`\b(\w+)\s+\1\b`, 'gi', 'Finds accidental duplicates like "the the".', 'This is is a test of the the system.', ['is is', 'the the']),
  f('empty-lines', 'Empty lines', 'text', R`^[ \t]*$`, 'gm', 'Matches blank lines (replace with nothing, then tidy up the line breaks).', 'one\n\ntwo\n  \nthree', ['', '  ']),
  f('quoted', 'Double-quoted strings', 'text', R`"(?:[^"\\]|\\.)*"`, 'g', 'Finds "text in quotes", including escaped quotes inside.', 'say "hi" and "a \\"quoted\\" word" now', ['"hi"', '"a \\"quoted\\" word"']),
  f('in-parens', 'Text in parentheses', 'text', R`\(([^)]*)\)`, 'g', 'Finds (text in brackets) and captures what is inside.', 'Call (now) or (later) ok', ['(now)', '(later)']),
  f('non-ascii', 'Non-ASCII characters', 'text', R`[^\x00-\x7F]`, 'g', 'Finds any character outside plain ASCII, useful for spotting smart quotes and accents.', 'caf\u00e9 \u201cquoted\u201d', ['\u00e9', '\u201c', '\u201d']),
  f('emoji', 'Emoji', 'text', R`\p{Extended_Pictographic}`, 'gu', 'Finds emoji and other pictographs.', 'Ship it \ud83d\ude80 with \u2764\ufe0f and \u2728', ['\ud83d\ude80', '\u2764', '\u2728']),
  f('capitalised', 'Capitalised words', 'text', R`\b[A-Z][a-z]+\b`, 'g', 'Finds words that start with a capital letter and continue in lowercase.', 'Asha met Bob in Pune.', ['Asha', 'Bob', 'Pune']),
  f('key-value', 'key=value pairs', 'text', R`(\w+)=([^&\s]+)`, 'g', 'Captures names and values from query strings or settings.', 'a=1&b=hello&c=x%20y', ['a=1', 'b=hello', 'c=x%20y']),
  // ---- Developer ----
  v('hex-color', 'Hex color', 'dev', R`^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`, 'CSS hex colors with 3, 4, 6 or 8 digits.', ['#fff', '#FF5733', '#ff573380', '#abcd'], ['fff', '#ggg', '#12345', '#1234567']),
  v('rgb-color', 'CSS rgb() / rgba()', 'dev', R`^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$`, 'Comma-separated rgb colors with an optional alpha.', ['rgb(255, 87, 51)', 'rgba(0,0,0,0.5)', 'rgb(0 , 0, 0)'], ['rgb(256, 0, 0)', 'rgb(1,2)', 'rgb(1,2,3,4)']),
  v('uuid', 'UUID', 'dev', R`^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'RFC 4122 / 9562 UUIDs, versions 1 to 8, in either case.', ['123e4567-e89b-12d3-a456-426614174000', '550E8400-E29B-41D4-A716-446655440000', '018f3d3e-7b2a-7c3f-9d1e-5a4b3c2d1e0f'], ['123e4567e89b12d3a456426614174000', '123e4567-e89b-02d3-a456-426614174000', 'not-a-uuid'], 'i'),
  v('semver', 'Semantic version', 'dev', R`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$`, 'The official semver.org pattern: 1.2.3, 1.0.0-beta.1, 2.0.0+build.5.', ['1.2.3', '1.0.0-beta.1', '2.0.0+build.5', '0.0.1-rc.1+exp.sha'], ['1.2', '01.2.3', '1.2.3.4', 'v1.2.3']),
  v('git-sha', 'Git commit hash', 'dev', R`^[0-9a-f]{7,40}$`, 'Short (7+) or full (40) lowercase hex commit IDs.', ['a1b2c3d', '3b18e512dba79e4c8300dd08aeb37f8e728b8dad'], ['a1b2c3', 'XYZ1234', 'A1B2C3D']),
  v('jwt', 'JWT (format)', 'dev', R`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$`, 'Three Base64URL parts separated by dots. It does not check the signature.', ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_123', 'aaa.bbb.'], ['aaa.bbb', 'aaa.bbb.ccc.ddd', 'aa a.bbb.ccc']),
  v('base64', 'Base64 string', 'dev', R`^(?:[A-Za-z0-9+\/]{4})+(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$|^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)$`, 'Standard Base64 with correct padding.', ['SGVsbG8=', 'SGVsbG8gd29ybGQ=', 'TWFu', 'YQ=='], ['SGVsbG8', 'abc$', 'SGVsbG8===', '']),
  v('windows-path', 'Windows file path', 'dev', R`^[A-Za-z]:\\(?:[^\\\/:*?"<>|\r\n]+\\)*[^\\\/:*?"<>|\r\n]*$`, 'Drive letter, then folders and a file name without the characters Windows forbids.', ['C:\\Users\\asha\\file.txt', 'D:\\', 'C:\\Program Files\\App'], ['C:/Users/asha', 'Users\\asha', 'C:\\bad|name']),
  v('unix-path', 'Unix file path', 'dev', R`^(?:\/[^\/\0]+)+\/?$|^\/$`, 'Absolute paths such as /usr/local/bin.', ['/usr/local/bin', '/etc/', '/'], ['usr/bin', '', 'C:\\x']),
  v('env-var', 'Environment variable name', 'dev', R`^[A-Z_][A-Z0-9_]*$`, 'Uppercase letters, digits and underscores, not starting with a digit.', ['PATH', 'MY_VAR_2', '_PRIVATE'], ['my_var', '2FAST', 'HAS-DASH']),
  v('aws-key', 'AWS access key ID', 'dev', R`^(?:AKIA|ASIA)[A-Z0-9]{16}$`, 'Access key IDs start with AKIA or ASIA and are 20 characters long.', ['AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE'], ['AKIAIOSFODNN7EXAMPL', 'BKIAIOSFODNN7EXAMPLE', 'akiaiosfodnn7example']),
  v('html-color-name', 'CSS identifier / class name', 'dev', R`^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$`, 'Valid CSS class or id names.', ['btn-primary', '_hidden', 'Card2', '-webkit-box'], ['1abc', '--', 'has space']),
  f('html-tags', 'HTML tags', 'dev', R`<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\/?>`, 'g', 'Finds opening, closing and self-closing HTML tags.', '<p class="a">Hi</p><br/>', ['<p class="a">', '</p>', '<br/>']),
  f('html-attrs', 'HTML attributes', 'dev', R`([\w:-]+)="([^"]*)"`, 'g', 'Captures attribute names and values written with double quotes.', '<a href="/x" target="_blank">', ['href="/x"', 'target="_blank"']),
  f('line-comments', 'Line comments (//)', 'dev', R`\/\/.*$`, 'gm', 'Finds // comments to the end of the line.', 'let a = 1 // one\nlet b = 2', ['// one']),
  f('block-comments', 'Block comments', 'dev', R`\/\*[\s\S]*?\*\/`, 'g', 'Finds /* ... */ comments, including multi-line ones.', 'a /* x */ b /* y\nz */ c', ['/* x */', '/* y\nz */']),
  f('file-ext', 'File extension', 'dev', R`\.([A-Za-z0-9]+)$`, '', 'Captures the extension at the end of a file name.', 'archive.tar.gz', ['.gz']),
  f('log-level', 'Log levels', 'dev', R`\b(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b`, 'g', 'Finds log level keywords in log lines.', '12:00 INFO start\n12:01 WARN slow\n12:02 ERROR boom', ['INFO', 'WARN', 'ERROR']),
]

/** Does this pattern use features not available in Go (RE2)? */
export const usesBacktracking = (p) => /\(\?<?[=!]|\\[1-9]|\\k</.test(p)

/** Translate a JS pattern for another language's flavour (just wrapping/escaping; patterns here are portable). */
export function asCode(pattern, flags, lang) {
  const fl = flags.replace(/[gdy]/g, '')
  const q = (s, c = '"') => c + s.replace(/\\/g, '\\\\').replace(new RegExp(c, 'g'), '\\' + c) + c
  switch (lang) {
    case 'js': return `/${pattern.replace(/(?<!\\)\//g, '\\/')}/${flags}`
    case 'jsnew': return `new RegExp(${q(pattern, "'")}${flags ? `, '${flags}'` : ''})`
    case 'python': return `re.compile(r${q(pattern)}${fl.includes('i') ? ', re.IGNORECASE' : ''}${fl.includes('m') ? (fl.includes('i') ? ' | ' : ', ') + 're.MULTILINE' : ''}${fl.includes('s') ? ' | re.DOTALL' : ''})`
    case 'php': return `'/${pattern.replace(/\//g, '\\/')}/${fl.replace('u', 'u')}'`
    case 'java': return `Pattern.compile(${q(pattern)}${fl.includes('i') ? ', Pattern.CASE_INSENSITIVE' : ''})`
    case 'go': return `regexp.MustCompile(\`${fl.includes('i') ? '(?i)' : ''}${fl.includes('m') ? '(?m)' : ''}${pattern}\`)`
    case 'csharp': return `new Regex(@${q(pattern.replace(/"/g, '""'), '"').replace(/\\\\/g, '\\')}${fl.includes('i') ? ', RegexOptions.IgnoreCase' : ''})`
    default: return pattern
  }
}
