// Example inputs for the "Try an example" chips.
export const USERS_JSON = `{"page":1,"total":2,"users":[{"id":101,"name":"Asha Rao","email":"asha@example.com","active":true,"joined":"2024-03-14T09:30:00Z","tags":["admin","beta"],"address":{"city":"Pune","zip":"411001"},"score":4.8},{"id":102,"name":"Liam Chen","email":"liam@example.com","active":false,"joined":"2025-01-02T18:05:12Z","tags":[],"address":null,"score":3}],"next":null}`
export const PACKAGE_JSON = `{"name":"tiny-app","version":"1.4.0","private":true,"scripts":{"dev":"vite","build":"vite build","test":"vitest run"},"dependencies":{"react":"^19.0.0","zod":"^4.1.0"},"devDependencies":{"vite":"^7.0.0","vitest":"^3.0.0"},"engines":{"node":">=20"}}`
export const BROKEN_JSON = `{
  // user settings
  name: 'Asha',
  "theme": "dark",
  "notifications": {"email": true, "sms": False,},
  "langs": ["en", "hi",],
}`
export const ORDER_JSON = `{"orderId":"A-1009","customer":{"id":7,"name":"Meera Iyer","vip":true},"items":[{"sku":"KB-01","qty":2,"price":49.5},{"sku":"MS-22","qty":1,"price":19.99},{"sku":"CB-USB","qty":3,"price":7}],"shipping":{"method":"express","address":{"line1":"12 MG Road","city":"Bengaluru","pin":"560001"}},"paid":true,"coupon":null}`
export const ORDER_JSON_B = `{"orderId":"A-1009","customer":{"id":7,"name":"Meera Iyer-Rao","vip":false},"items":[{"sku":"KB-01","qty":3,"price":49.5},{"sku":"CB-USB","qty":3,"price":7},{"sku":"HD-9","qty":1,"price":89}],"shipping":{"address":{"city":"Bengaluru","line1":"12 MG Road","pin":"560001"},"method":"standard"},"paid":true,"notes":"Leave at the door"}`
export const EVENTS_JSON = `[{"id":"3f2b8c1e-5d7a-4e2f-9a11-0c6b7d1e2a90","type":"signup","email":"nina@example.com","at":"2025-06-01T10:15:00Z","site":"https://example.com/join","meta":{"plan":"pro","trial":true,"seats":5}},{"id":"b1c5d9a2-77f0-4c3e-8d21-4a6f0e9b3c11","type":"login","email":"omar@example.com","at":"2025-06-02T08:00:30+05:30","ip":"203.0.113.9","meta":{"plan":"free","seats":1}},{"id":"9d3e7f40-1a2b-4c5d-8e6f-7a8b9c0d1e2f","type":"logout","email":"nina@example.com","at":"2025-06-02T11:42:00Z","meta":{"plan":"pro","trial":false,"seats":5,"note":null}}]`
