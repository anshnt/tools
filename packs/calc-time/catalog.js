// Pack calc-time: date, time, age and unit converters. Default category: calc.
export const cat = 'calc'
export default [
  { id: 'age-calculator', name: 'Age calculator', desc: 'Exact age in years, months and days, on any date, plus next birthday.', icon: 'cake', also: ['personal'], tags: 'age birthday exact dob' },
  { id: 'date-difference', name: 'How many days between dates', desc: 'Days, weeks, months and years between two dates.', icon: 'calendar-range', tags: 'days between dates difference' },
  { id: 'add-days-to-date', name: 'Date + N days', desc: 'Add or subtract days, weeks, months or business days from a date.', icon: 'calendar-plus', tags: 'add subtract date' },
  { id: 'working-days', name: 'Working days calculator', desc: 'Business days between dates, excluding weekends and holidays.', icon: 'briefcase', also: ['career'], tags: 'business days weekdays holidays' },
  { id: 'business-days-india', name: 'Business days (Indian holidays)', module: 'working-days', params: { holidays: 'in' }, cat: 'india', desc: 'Working days between dates excluding Indian public holidays.', icon: 'calendar-check', tags: 'india holidays gazetted bank' },
  { id: 'time-difference', name: 'Time & duration calculator', desc: 'Hours between times, add up durations, and convert time units.', icon: 'clock', tags: 'hours minutes duration add time' },
  { id: 'time-zone-converter', name: 'Time zone converter', desc: 'Convert a time between cities and time zones (IST, PST, GMT...).', icon: 'globe', tags: 'timezone ist utc gmt' },
  { id: 'meeting-planner', name: 'Meeting time planner', desc: 'Find overlapping working hours across time zones.', icon: 'users', also: ['career'], tags: 'time zone overlap meeting' },
  { id: 'countdown-generator', name: 'Countdown generator', desc: 'Create a shareable countdown link to any date and time.', icon: 'hourglass', also: ['personal'], tags: 'countdown event timer link' },
  { id: 'unit-converter', name: 'Unit converter', desc: 'Convert length, weight, temperature, area, volume, speed and more.', icon: 'arrow-left-right', tags: 'convert units metric imperial' },
  { id: 'length-converter', name: 'Length converter', module: 'unit-converter', params: { kind: 'length' }, desc: 'km, m, cm, mm, miles, feet, inches and more.', icon: 'ruler', tags: 'feet inches meters' },
  { id: 'weight-converter', name: 'Weight converter', module: 'unit-converter', params: { kind: 'weight' }, desc: 'kg, g, lb, oz, tonnes and more.', icon: 'weight', tags: 'kg lbs pounds' },
  { id: 'temperature-converter', name: 'Temperature converter', module: 'unit-converter', params: { kind: 'temperature' }, desc: 'Celsius, Fahrenheit and Kelvin.', icon: 'thermometer', tags: 'celsius fahrenheit' },
  { id: 'area-converter', name: 'Area converter', module: 'unit-converter', params: { kind: 'area' }, desc: 'sq ft, sq m, acres, hectares, bigha, guntha and more.', icon: 'square-dashed', tags: 'sqft acre hectare bigha' },
  { id: 'volume-converter', name: 'Volume converter', module: 'unit-converter', params: { kind: 'volume' }, desc: 'Litres, ml, gallons, cups, cubic meters and more.', icon: 'cylinder', tags: 'litre gallon cup' },
  { id: 'speed-converter', name: 'Speed converter', module: 'unit-converter', params: { kind: 'speed' }, desc: 'km/h, mph, m/s and knots.', icon: 'gauge', tags: 'kmh mph' },
  { id: 'data-storage-converter', name: 'Data storage converter', module: 'unit-converter', params: { kind: 'data' }, desc: 'Bytes, KB, MB, GB, TB (decimal and binary).', icon: 'hard-drive', also: ['dev'], tags: 'mb gb kb bytes mib' },
  { id: 'number-to-words', name: 'Number to words', desc: 'Write numbers in words (international and Indian lakh/crore).', icon: 'whole-word', also: ['india'], tags: 'amount in words cheque lakh crore' },
  { id: 'roman-numerals', name: 'Roman numeral converter', desc: 'Convert numbers to Roman numerals and back.', icon: 'type', tags: 'roman numerals' },
  { id: 'week-number', name: 'Week number', desc: 'ISO week number of any date and the dates in any week.', icon: 'calendar-days', tags: 'iso week' },
]
