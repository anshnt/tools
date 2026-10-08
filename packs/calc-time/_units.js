// Unit data and conversion maths for the unit converters (pure, no DOM). Every unit is stored as the number of base units in one of it,
// or as to/from functions (temperature, fuel economy). Factors are exact definitions where one exists (international foot, avoirdupois pound, US gallon...).

const SQFT = 0.09290304 // m2 in a square foot (exact)
const ML_US_CUP = 236.5882365
const f = (id, name, sym, factor, group, extra = {}) => ({ id, name, sym, f: factor, group, ...extra })

/** Bigha varies by state (and often by district). Square feet in one bigha, from commonly published local standards. Check your land record. */
export const BIGHA_STATES = [
  ['up', 'Uttar Pradesh (pucca)', 27225], ['bihar', 'Bihar', 27225], ['raj', 'Rajasthan (pucca)', 27225], ['raj-k', 'Rajasthan (kachha)', 17424], ['hr', 'Haryana', 21780], ['pb', 'Punjab', 21780],
  ['gj', 'Gujarat', 17424], ['mp', 'Madhya Pradesh', 12000], ['hp', 'Himachal Pradesh', 8712], ['uk', 'Uttarakhand (plains)', 17424], ['wb', 'West Bengal', 14400], ['as', 'Assam', 14400],
]

/** Ingredient densities for the cooking converter: grams in one US cup (approximate, level cup, spooned). */
export const INGREDIENTS = [
  ['water', 'Water or milk', 237], ['flour', 'Plain flour (maida)', 120], ['atta', 'Whole wheat flour (atta)', 120], ['sugar', 'Sugar (granulated)', 200], ['icing', 'Powdered sugar', 120],
  ['brown', 'Brown sugar (packed)', 213], ['butter', 'Butter', 227], ['ghee', 'Ghee', 218], ['oil', 'Cooking oil', 218], ['honey', 'Honey', 340], ['rice', 'Rice (uncooked)', 185],
  ['oats', 'Rolled oats', 90], ['cocoa', 'Cocoa powder', 85], ['salt', 'Table salt', 288], ['curd', 'Curd or yogurt', 245], ['pb', 'Peanut butter', 258],
]

export const KINDS = {
  length: {
    name: 'Length', icon: 'ruler', from: 'mi', to: 'km', hint: 'Metric and imperial lengths, from nanometres to light-years.',
    units: [
      f('km', 'Kilometre', 'km', 1000, 'Metric'), f('m', 'Metre', 'm', 1, 'Metric'), f('cm', 'Centimetre', 'cm', 0.01, 'Metric'), f('mm', 'Millimetre', 'mm', 0.001, 'Metric'),
      f('um', 'Micrometre', 'µm', 1e-6, 'Metric'), f('nm', 'Nanometre', 'nm', 1e-9, 'Metric'),
      f('mi', 'Mile', 'mi', 1609.344, 'Imperial and US'), f('yd', 'Yard', 'yd', 0.9144, 'Imperial and US'), f('ft', 'Foot', 'ft', 0.3048, 'Imperial and US'), f('in', 'Inch', 'in', 0.0254, 'Imperial and US'),
      f('nmi', 'Nautical mile', 'nmi', 1852, 'Other'), f('ly', 'Light-year', 'ly', 9.4607304725808e15, 'Other'),
    ],
    presets: [['1 mile', 1, 'mi'], ['100 m', 100, 'm'], ['6 ft', 6, 'ft'], ['1 marathon', 42.195, 'km']],
    compound: [['ft', 'ft'], ['in', 'in']], mixed: [['ft', 'in'], ['yd', 'ft', 'in']],
  },
  weight: {
    name: 'Weight', icon: 'weight', from: 'kg', to: 'lb', hint: 'Mass in kilograms, pounds, tolas, quintals and more.',
    units: [
      f('t', 'Tonne (metric ton)', 't', 1000, 'Metric'), f('q', 'Quintal', 'q', 100, 'Metric'), f('kg', 'Kilogram', 'kg', 1, 'Metric'), f('g', 'Gram', 'g', 0.001, 'Metric'), f('mg', 'Milligram', 'mg', 1e-6, 'Metric'),
      f('ug', 'Microgram', 'µg', 1e-9, 'Metric'), f('ct', 'Carat', 'ct', 0.0002, 'Metric'), f('tola', 'Tola', 'tola', 0.0116638038, 'Indian'),
      f('lb', 'Pound', 'lb', 0.45359237, 'Imperial and US'), f('oz', 'Ounce', 'oz', 0.028349523125, 'Imperial and US'), f('st', 'Stone', 'st', 6.35029318, 'Imperial and US'),
      f('ston', 'US ton (short)', 'ton', 907.18474, 'Imperial and US'), f('lton', 'UK ton (long)', 'long ton', 1016.0469088, 'Imperial and US'),
    ],
    presets: [['1 kg', 1, 'kg'], ['1 lb', 1, 'lb'], ['10 g (gold)', 10, 'g'], ['1 quintal', 1, 'q']],
    compound: [['st', 'st'], ['lb', 'lb']], mixed: [['st', 'lb'], ['lb', 'oz']],
  },
  temperature: {
    name: 'Temperature', icon: 'thermometer', from: 'c', to: 'f', hint: 'Celsius, Fahrenheit, Kelvin and Rankine.',
    units: [
      { id: 'c', name: 'Celsius', sym: '°C', to: (v) => v + 273.15, from: (b) => b - 273.15, group: 'Common' },
      { id: 'f', name: 'Fahrenheit', sym: '°F', to: (v) => ((v - 32) * 5) / 9 + 273.15, from: (b) => ((b - 273.15) * 9) / 5 + 32, group: 'Common' },
      { id: 'k', name: 'Kelvin', sym: 'K', to: (v) => v, from: (b) => b, group: 'Scientific' },
      { id: 'r', name: 'Rankine', sym: '°R', to: (v) => (v * 5) / 9, from: (b) => (b * 9) / 5, group: 'Scientific' },
    ],
    presets: [['Freezing', 0, 'c'], ['Room', 25, 'c'], ['Body', 37, 'c'], ['Boiling', 100, 'c'], ['Oven', 180, 'c']],
    formula: true,
  },
  area: {
    name: 'Area', icon: 'square-dashed', from: 'sqft', to: 'sqm', hint: 'Square feet to acres, hectares, gaj, guntha, bigha and more.',
    units: [
      f('km2', 'Square kilometre', 'km²', 1e6, 'Metric'), f('ha', 'Hectare', 'ha', 1e4, 'Metric'), f('are', 'Are', 'a', 100, 'Metric'), f('sqm', 'Square metre', 'm²', 1, 'Metric'),
      f('cm2', 'Square centimetre', 'cm²', 1e-4, 'Metric'), f('mm2', 'Square millimetre', 'mm²', 1e-6, 'Metric'),
      f('sqmi', 'Square mile', 'sq mi', 2589988.110336, 'Imperial and US'), f('acre', 'Acre', 'ac', 4046.8564224, 'Imperial and US'), f('sqyd', 'Square yard (gaj)', 'sq yd', 0.83612736, 'Imperial and US'),
      f('sqft', 'Square foot', 'sq ft', SQFT, 'Imperial and US'), f('sqin', 'Square inch', 'sq in', 0.00064516, 'Imperial and US'),
      f('guntha', 'Guntha', 'guntha', 1089 * SQFT, 'Indian land', { india: true }), f('cent', 'Cent (decimal)', 'cent', 435.6 * SQFT, 'Indian land', { india: true }),
      f('ground', 'Ground (Tamil Nadu)', 'ground', 2400 * SQFT, 'Indian land', { india: true }), f('kanal', 'Kanal', 'kanal', 5445 * SQFT, 'Indian land', { india: true }),
      f('marla', 'Marla', 'marla', 272.25 * SQFT, 'Indian land', { india: true }),
      f('bigha', 'Bigha', 'bigha', 27225 * SQFT, 'Indian land', { india: true, state: true }), f('biswa', 'Biswa', 'biswa', (27225 * SQFT) / 20, 'Indian land', { india: true, state: true, biswa: true }),
    ],
    presets: [['1 acre', 1, 'acre'], ['1 bigha', 1, 'bigha'], ['1 guntha', 1, 'guntha'], ['1000 sq ft', 1000, 'sqft']],
    indiaOrder: ['sqft', 'sqyd', 'sqm', 'guntha', 'cent', 'ground', 'bigha', 'biswa', 'kanal', 'marla', 'acre', 'ha', 'are'],
  },
  volume: {
    name: 'Volume', icon: 'cylinder', from: 'l', to: 'usgal', hint: 'Litres, gallons, cups, tablespoons and teaspoons (US and metric).',
    units: [
      f('m3', 'Cubic metre', 'm³', 1000, 'Metric'), f('l', 'Litre', 'L', 1, 'Metric'), f('ml', 'Millilitre', 'mL', 0.001, 'Metric'),
      f('mcup', 'Metric cup', 'cup', 0.25, 'Kitchen (metric)'), f('mtbsp', 'Metric tablespoon', 'tbsp', 0.015, 'Kitchen (metric)'), f('mtsp', 'Metric teaspoon', 'tsp', 0.005, 'Kitchen (metric)'),
      f('usgal', 'US gallon', 'gal', 3.785411784, 'US customary'), f('usqt', 'US quart', 'qt', 0.946352946, 'US customary'), f('uspt', 'US pint', 'pt', 0.473176473, 'US customary'),
      f('uscup', 'US cup', 'cup', 0.2365882365, 'US customary'), f('usfloz', 'US fluid ounce', 'fl oz', 0.0295735295625, 'US customary'), f('ustbsp', 'US tablespoon', 'tbsp', 0.01478676478125, 'US customary'),
      f('ustsp', 'US teaspoon', 'tsp', 0.00492892159375, 'US customary'),
      f('ukgal', 'Imperial gallon', 'imp gal', 4.54609, 'Imperial'), f('ukqt', 'Imperial quart', 'imp qt', 1.1365225, 'Imperial'), f('ukpt', 'Imperial pint', 'imp pt', 0.56826125, 'Imperial'),
      f('ukfloz', 'Imperial fluid ounce', 'imp fl oz', 0.0284130625, 'Imperial'),
      f('ft3', 'Cubic foot', 'ft³', 28.316846592, 'Cubic'), f('in3', 'Cubic inch', 'in³', 0.016387064, 'Cubic'), f('yd3', 'Cubic yard', 'yd³', 764.554857984, 'Cubic'),
    ],
    presets: [['1 US cup', 1, 'uscup'], ['1 gallon', 1, 'usgal'], ['500 mL', 500, 'ml'], ['1 tbsp', 1, 'ustbsp']],
  },
  speed: {
    name: 'Speed', icon: 'gauge', from: 'kmh', to: 'mph', hint: 'Kilometres per hour, miles per hour, metres per second, knots and Mach.',
    units: [
      f('ms', 'Metre per second', 'm/s', 1, 'Metric'), f('kmh', 'Kilometre per hour', 'km/h', 1 / 3.6, 'Metric'), f('kms', 'Kilometre per second', 'km/s', 1000, 'Metric'), f('cms', 'Centimetre per second', 'cm/s', 0.01, 'Metric'),
      f('mph', 'Mile per hour', 'mph', 0.44704, 'Imperial and US'), f('fts', 'Foot per second', 'ft/s', 0.3048, 'Imperial and US'), f('kn', 'Knot', 'kn', 1852 / 3600, 'Sea and air'),
      f('mach', 'Mach (sea level, 15 °C)', 'Mach', 340.29, 'Sea and air'), f('c', 'Speed of light', 'c', 299792458, 'Other'),
    ],
    presets: [['100 km/h', 100, 'kmh'], ['60 mph', 60, 'mph'], ['Mach 1', 1, 'mach'], ['1 knot', 1, 'kn']],
  },
  data: {
    name: 'Data storage', icon: 'hard-drive', from: 'gb', to: 'gib', hint: 'Bytes, KB, MB, GB, TB (decimal) and KiB, MiB, GiB, TiB (binary), plus bits.',
    units: [
      f('b', 'Bit', 'bit', 0.125, 'Bits'), f('kbit', 'Kilobit', 'kbit', 125, 'Bits'), f('mbit', 'Megabit', 'Mbit', 125000, 'Bits'), f('gbit', 'Gigabit', 'Gbit', 1.25e8, 'Bits'), f('tbit', 'Terabit', 'Tbit', 1.25e11, 'Bits'),
      f('byte', 'Byte', 'B', 1, 'Decimal (1000)'), f('kb', 'Kilobyte', 'KB', 1e3, 'Decimal (1000)'), f('mb', 'Megabyte', 'MB', 1e6, 'Decimal (1000)'), f('gb', 'Gigabyte', 'GB', 1e9, 'Decimal (1000)'),
      f('tb', 'Terabyte', 'TB', 1e12, 'Decimal (1000)'), f('pb', 'Petabyte', 'PB', 1e15, 'Decimal (1000)'), f('eb', 'Exabyte', 'EB', 1e18, 'Decimal (1000)'),
      f('kib', 'Kibibyte', 'KiB', 1024, 'Binary (1024)'), f('mib', 'Mebibyte', 'MiB', 1024 ** 2, 'Binary (1024)'), f('gib', 'Gibibyte', 'GiB', 1024 ** 3, 'Binary (1024)'),
      f('tib', 'Tebibyte', 'TiB', 1024 ** 4, 'Binary (1024)'), f('pib', 'Pebibyte', 'PiB', 1024 ** 5, 'Binary (1024)'),
    ],
    presets: [['1 GB', 1, 'gb'], ['1 TB', 1, 'tb'], ['100 Mbit', 100, 'mbit'], ['1 MiB', 1, 'mib']],
  },
  time: {
    name: 'Time', icon: 'clock', from: 'h', to: 'min', hint: 'Seconds to years. A month is 30.44 days and a year 365.24 days on average.',
    units: [
      f('ns', 'Nanosecond', 'ns', 1e-9, 'Small'), f('us', 'Microsecond', 'µs', 1e-6, 'Small'), f('ms', 'Millisecond', 'ms', 1e-3, 'Small'),
      f('s', 'Second', 's', 1, 'Everyday'), f('min', 'Minute', 'min', 60, 'Everyday'), f('h', 'Hour', 'h', 3600, 'Everyday'), f('d', 'Day', 'd', 86400, 'Everyday'), f('wk', 'Week', 'wk', 604800, 'Everyday'),
      f('mo', 'Month (average)', 'mo', 2629746, 'Long'), f('yr', 'Year (average)', 'yr', 31556952, 'Long'), f('dec', 'Decade', 'decade', 315569520, 'Long'), f('cen', 'Century', 'century', 3155695200, 'Long'),
    ],
    presets: [['1 year', 1, 'yr'], ['1 week', 1, 'wk'], ['1 day', 1, 'd'], ['10000 hours', 10000, 'h']],
    mixed: [['d', 'h', 'min', 's']],
  },
  pressure: {
    name: 'Pressure', icon: 'gauge', from: 'psi', to: 'bar', hint: 'Pascal, bar, psi, atmospheres, mmHg and kgf/cm².',
    units: [
      f('pa', 'Pascal', 'Pa', 1, 'SI'), f('hpa', 'Hectopascal (millibar)', 'hPa', 100, 'SI'), f('kpa', 'Kilopascal', 'kPa', 1e3, 'SI'), f('mpa', 'Megapascal', 'MPa', 1e6, 'SI'),
      f('bar', 'Bar', 'bar', 1e5, 'Common'), f('atm', 'Atmosphere', 'atm', 101325, 'Common'), f('psi', 'Pound per sq inch', 'psi', 6894.757293168, 'Common'), f('kgcm2', 'Kilogram-force per cm²', 'kgf/cm²', 98066.5, 'Common'),
      f('mmhg', 'Millimetre of mercury', 'mmHg', 101325 / 760, 'Other'), f('torr', 'Torr', 'Torr', 101325 / 760, 'Other'), f('inhg', 'Inch of mercury', 'inHg', 3386.389, 'Other'),
    ],
    presets: [['1 atm', 1, 'atm'], ['32 psi (car tyre)', 32, 'psi'], ['1 bar', 1, 'bar'], ['120 mmHg', 120, 'mmhg']],
  },
  energy: {
    name: 'Energy', icon: 'zap', from: 'kwh', to: 'mj', hint: 'Joules, calories, kWh (electricity units), BTU and more.',
    units: [
      f('j', 'Joule', 'J', 1, 'SI'), f('kj', 'Kilojoule', 'kJ', 1e3, 'SI'), f('mj', 'Megajoule', 'MJ', 1e6, 'SI'), f('gj', 'Gigajoule', 'GJ', 1e9, 'SI'),
      f('wh', 'Watt-hour', 'Wh', 3600, 'Electricity'), f('kwh', 'Kilowatt-hour (unit)', 'kWh', 3.6e6, 'Electricity'),
      f('cal', 'Calorie (small)', 'cal', 4.184, 'Heat and food'), f('kcal', 'Kilocalorie (food Calorie)', 'kcal', 4184, 'Heat and food'), f('btu', 'British thermal unit', 'BTU', 1055.05585262, 'Heat and food'),
      f('therm', 'Therm (US)', 'therm', 105480400, 'Heat and food'), f('ftlb', 'Foot-pound', 'ft·lbf', 1.3558179483314004, 'Other'), f('ev', 'Electronvolt', 'eV', 1.602176634e-19, 'Other'), f('erg', 'Erg', 'erg', 1e-7, 'Other'),
    ],
    presets: [['1 kWh', 1, 'kwh'], ['1 kcal', 1, 'kcal'], ['1 BTU', 1, 'btu'], ['2000 kcal', 2000, 'kcal']],
  },
  power: {
    name: 'Power', icon: 'plug-zap', from: 'hp', to: 'kw', hint: 'Watts, kilowatts, horsepower, BTU per hour and tons of refrigeration.',
    units: [
      f('w', 'Watt', 'W', 1, 'SI'), f('kw', 'Kilowatt', 'kW', 1e3, 'SI'), f('mw', 'Megawatt', 'MW', 1e6, 'SI'), f('gw', 'Gigawatt', 'GW', 1e9, 'SI'),
      f('hp', 'Horsepower (mechanical)', 'hp', 745.69987158227, 'Engines'), f('ps', 'Metric horsepower (PS)', 'PS', 735.49875, 'Engines'),
      f('btuh', 'BTU per hour', 'BTU/h', 0.29307107017, 'Heating and cooling'), f('tr', 'Ton of refrigeration (AC ton)', 'TR', 3516.8528421, 'Heating and cooling'), f('kcalh', 'Kilocalorie per hour', 'kcal/h', 1.1622222222, 'Heating and cooling'),
      f('ftlbs', 'Foot-pound per second', 'ft·lbf/s', 1.3558179483314004, 'Other'),
    ],
    presets: [['1 hp', 1, 'hp'], ['1.5 ton AC', 1.5, 'tr'], ['1 kW', 1, 'kw'], ['12000 BTU/h', 12000, 'btuh']],
  },
  fuel: {
    name: 'Fuel economy', icon: 'fuel', from: 'kml', to: 'mpgus', hint: 'km/L, litres per 100 km and miles per gallon (US and UK).',
    units: [
      f('kml', 'Kilometre per litre', 'km/L', 1, 'Metric'),
      { id: 'l100', name: 'Litres per 100 km', sym: 'L/100km', to: (v) => 100 / v, from: (b) => 100 / b, group: 'Metric' },
      f('mil', 'Mile per litre', 'mi/L', 1.609344, 'Mixed'),
      f('mpgus', 'Mile per US gallon', 'mpg (US)', 0.4251437075, 'Miles per gallon'), f('mpguk', 'Mile per imperial gallon', 'mpg (UK)', 0.3540061899, 'Miles per gallon'),
    ],
    presets: [['15 km/L', 15, 'kml'], ['6.5 L/100km', 6.5, 'l100'], ['35 mpg (US)', 35, 'mpgus'], ['40 mpg (UK)', 40, 'mpguk']],
  },
  cooking: {
    name: 'Cooking', icon: 'chef-hat', from: 'uscup', to: 'g', hint: 'Cups, spoons, grams and ounces for common ingredients.',
    units: [], // built by unitsFor() from the chosen ingredient
    presets: [['1 cup', 1, 'uscup'], ['1 tbsp', 1, 'ustbsp'], ['100 g', 100, 'g'], ['1 stick butter', 113, 'g']],
  },
}

/** Cooking units: volumes in millilitres, masses via the ingredient's density (g per ml). */
function cookingUnits(gramsPerCup) {
  const d = gramsPerCup / ML_US_CUP
  return [
    f('uscup', 'US cup', 'cup', ML_US_CUP, 'Volume'), f('mcup', 'Metric cup', 'cup', 250, 'Volume'), f('ustbsp', 'US tablespoon', 'tbsp', 14.78676478125, 'Volume'), f('mtbsp', 'Metric tablespoon', 'tbsp', 15, 'Volume'),
    f('ustsp', 'US teaspoon', 'tsp', 4.92892159375, 'Volume'), f('mtsp', 'Metric teaspoon', 'tsp', 5, 'Volume'), f('usfloz', 'US fluid ounce', 'fl oz', 29.5735295625, 'Volume'),
    f('ml', 'Millilitre', 'mL', 1, 'Volume'), f('l', 'Litre', 'L', 1000, 'Volume'),
    f('g', 'Gram', 'g', 1 / d, 'Weight'), f('kg', 'Kilogram', 'kg', 1000 / d, 'Weight'), f('oz', 'Ounce', 'oz', 28.349523125 / d, 'Weight'), f('lb', 'Pound', 'lb', 453.59237 / d, 'Weight'),
  ]
}

/**
 * The units of a kind. ctx: {bigha: sq ft per bigha (area), grams: g per US cup (cooking), india: only the Indian land set (area)}.
 * Bigha and biswa follow the chosen state.
 */
export function unitsFor(kind, ctx = {}) {
  const K = KINDS[kind]
  let list = kind === 'cooking' ? cookingUnits(ctx.grams || 237) : K.units
  if (kind === 'area') {
    list = list.map((u) => (u.state ? { ...u, f: (ctx.bigha || 27225) * SQFT / (u.biswa ? 20 : 1) } : u))
    if (ctx.india) list = K.indiaOrder.map((id) => ({ ...list.find((u) => u.id === id), group: 'Land units' }))
  }
  return list
}

/** Value in unit `u` -> base units, and back. NaN stays NaN. */
export const toBase = (u, v) => (u.to ? u.to(v) : v * u.f)
export const fromBase = (u, b) => (u.from ? u.from(b) : b / u.f)
export const convert = (v, from, to) => fromBase(to, toBase(from, v))

/** "Auto" shows up to 10 significant digits without trailing noise; a number shows that many decimals. */
export function fmtVal(x, prec = 'auto', { group = false, locale } = {}) {
  if (!Number.isFinite(x)) return '-'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (prec === 'auto') {
    if (a >= 1e21 || a < 1e-9) return Number(x.toPrecision(7)).toExponential().replace(/\.?0+e/, 'e').replace('e+', 'e')
    return Number(x.toPrecision(10)).toLocaleString(locale || 'en-US', { maximumFractionDigits: 15, useGrouping: group })
  }
  const n = +prec
  if (a >= 1e21) return x.toExponential(n)
  return x.toLocaleString(locale || 'en-US', { minimumFractionDigits: n, maximumFractionDigits: n, useGrouping: group })
}

/** Parse what people type: "1,250.5", " 3e8 ", "1.2". Commas are thousands separators. NaN when empty or unreadable. */
export function parseNum(s) {
  const t = String(s ?? '').replace(/[\s,_]/g, '')
  return t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? NaN : parseFloat(t)
}

/** Break a value into mixed units, e.g. mixed(1.778, m, [ft, in]) -> "5 ft 9.98 in". Last unit keeps decimals. units: array of unit objects, largest first. */
export function mixedText(units, baseValue) {
  if (!Number.isFinite(baseValue)) return ''
  const neg = baseValue < 0
  let rest = Math.abs(baseValue)
  const parts = []
  units.forEach((u, i) => {
    const v = fromBase(u, rest)
    if (i === units.length - 1) parts.push(`${Number(v.toFixed(2)).toLocaleString('en-US')} ${u.sym}`)
    else { const whole = Math.floor(v + 1e-9); parts.push(whole ? `${whole.toLocaleString('en-US')} ${u.sym}` : null); rest -= toBase(u, whole) }
  })
  return (neg ? '-' : '') + parts.filter(Boolean).join(' ')
}
