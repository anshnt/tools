// Railway helpers: PNR and train number checks, a train category guide, and a station code list (major stations only, compiled from
// public Indian Railways station lists). Pure data and functions, no DOM.

/** [code, name, state] */
const ST = `NDLS|New Delhi|Delhi;DLI|Delhi Junction (Old Delhi)|Delhi;NZM|Hazrat Nizamuddin|Delhi;ANVT|Anand Vihar Terminal|Delhi;DEE|Delhi Sarai Rohilla|Delhi;DSA|Delhi Shahdara|Delhi;
GZB|Ghaziabad Junction|Uttar Pradesh;MTC|Meerut City|Uttar Pradesh;SRE|Saharanpur|Uttar Pradesh;MB|Moradabad|Uttar Pradesh;BE|Bareilly Junction|Uttar Pradesh;LKO|Lucknow Charbagh|Uttar Pradesh;LJN|Lucknow Junction|Uttar Pradesh;
CNB|Kanpur Central|Uttar Pradesh;PRYJ|Prayagraj Junction|Uttar Pradesh;BSB|Varanasi Junction|Uttar Pradesh;BCY|Banaras|Uttar Pradesh;GKP|Gorakhpur Junction|Uttar Pradesh;AY|Ayodhya Junction|Uttar Pradesh;AYC|Ayodhya Cantt|Uttar Pradesh;
AGC|Agra Cantt|Uttar Pradesh;MTJ|Mathura Junction|Uttar Pradesh;JHS|Jhansi Junction|Uttar Pradesh;
UMB|Ambala Cantt Junction|Haryana;UBC|Ambala City|Haryana;KUN|Karnal|Haryana;PNP|Panipat Junction|Haryana;KKDE|Kurukshetra Junction|Haryana;ROK|Rohtak Junction|Haryana;RE|Rewari Junction|Haryana;HSR|Hisar Junction|Haryana;
ASR|Amritsar Junction|Punjab;LDH|Ludhiana Junction|Punjab;JUC|Jalandhar City|Punjab;PTK|Pathankot|Punjab;FZR|Firozpur Cantt|Punjab;BTI|Bathinda Junction|Punjab;CDG|Chandigarh|Chandigarh;KLK|Kalka|Haryana;
JAT|Jammu Tawi|Jammu and Kashmir;SVDK|Shri Mata Vaishno Devi Katra|Jammu and Kashmir;UHL|Una Himachal|Himachal Pradesh;SML|Shimla|Himachal Pradesh;
DDN|Dehradun|Uttarakhand;HW|Haridwar Junction|Uttarakhand;RK|Roorkee|Uttarakhand;KGM|Kathgodam|Uttarakhand;
JP|Jaipur Junction|Rajasthan;AII|Ajmer Junction|Rajasthan;JU|Jodhpur Junction|Rajasthan;BKN|Bikaner Junction|Rajasthan;UDZ|Udaipur City|Rajasthan;ABR|Abu Road|Rajasthan;KOTA|Kota Junction|Rajasthan;SWM|Sawai Madhopur|Rajasthan;BTE|Bharatpur Junction|Rajasthan;AWR|Alwar|Rajasthan;COR|Chittaurgarh|Rajasthan;JSM|Jaisalmer|Rajasthan;BME|Barmer|Rajasthan;SGNR|Sri Ganganagar|Rajasthan;
ADI|Ahmedabad Junction|Gujarat;BRC|Vadodara Junction|Gujarat;ST|Surat|Gujarat;RJT|Rajkot Junction|Gujarat;BVC|Bhavnagar Terminus|Gujarat;JAM|Jamnagar|Gujarat;BHUJ|Bhuj|Gujarat;GIMB|Gandhidham|Gujarat;PBR|Porbandar|Gujarat;OKHA|Okha|Gujarat;DWK|Dwarka|Gujarat;VAPI|Vapi|Gujarat;BL|Valsad|Gujarat;
BCT|Mumbai Central|Maharashtra;CSMT|Mumbai CSMT|Maharashtra;LTT|Lokmanya Tilak Terminus|Maharashtra;DR|Dadar (Central)|Maharashtra;DDR|Dadar (Western)|Maharashtra;BDTS|Bandra Terminus|Maharashtra;PNVL|Panvel|Maharashtra;KYN|Kalyan Junction|Maharashtra;TNA|Thane|Maharashtra;
PUNE|Pune Junction|Maharashtra;NK|Nashik Road|Maharashtra;SUR|Solapur|Maharashtra;KOP|Kolhapur CSMT|Maharashtra;AWB|Chhatrapati Sambhajinagar (Aurangabad)|Maharashtra;NED|Hazur Sahib Nanded|Maharashtra;NGP|Nagpur Junction|Maharashtra;
MAO|Madgaon Junction|Goa;VSG|Vasco da Gama|Goa;KRMI|Karmali|Goa;
BPL|Bhopal Junction|Madhya Pradesh;RKMP|Rani Kamlapati (Habibganj)|Madhya Pradesh;INDB|Indore Junction|Madhya Pradesh;UJN|Ujjain Junction|Madhya Pradesh;JBP|Jabalpur|Madhya Pradesh;GWL|Gwalior Junction|Madhya Pradesh;ET|Itarsi Junction|Madhya Pradesh;
R|Raipur Junction|Chhattisgarh;BSP|Bilaspur Junction|Chhattisgarh;DURG|Durg|Chhattisgarh;
SBC|KSR Bengaluru City|Karnataka;YPR|Yesvantpur Junction|Karnataka;BNC|Bengaluru Cantt|Karnataka;SMVB|SMVT Bengaluru|Karnataka;MYS|Mysuru Junction|Karnataka;UBL|Hubballi Junction|Karnataka;MAJN|Mangaluru Junction|Karnataka;MAQ|Mangaluru Central|Karnataka;
MAS|Chennai Central|Tamil Nadu;MS|Chennai Egmore|Tamil Nadu;TBM|Tambaram|Tamil Nadu;CBE|Coimbatore Junction|Tamil Nadu;MDU|Madurai Junction|Tamil Nadu;TPJ|Tiruchirappalli Junction|Tamil Nadu;SA|Salem Junction|Tamil Nadu;ED|Erode Junction|Tamil Nadu;TEN|Tirunelveli Junction|Tamil Nadu;KPD|Katpadi Junction|Tamil Nadu;CAPE|Kanniyakumari|Tamil Nadu;RMM|Rameswaram|Tamil Nadu;
PDY|Puducherry|Puducherry;
TVC|Thiruvananthapuram Central|Kerala;ERS|Ernakulam Junction|Kerala;ERN|Ernakulam Town|Kerala;CLT|Kozhikode|Kerala;CAN|Kannur|Kerala;PGT|Palakkad Junction|Kerala;QLN|Kollam Junction|Kerala;KTYM|Kottayam|Kerala;TCR|Thrissur|Kerala;ALLP|Alappuzha|Kerala;
SC|Secunderabad Junction|Telangana;HYB|Hyderabad Deccan (Nampally)|Telangana;KCG|Kacheguda|Telangana;WL|Warangal|Telangana;
BZA|Vijayawada Junction|Andhra Pradesh;VSKP|Visakhapatnam|Andhra Pradesh;TPTY|Tirupati|Andhra Pradesh;GNT|Guntur Junction|Andhra Pradesh;RU|Renigunta Junction|Andhra Pradesh;NLR|Nellore|Andhra Pradesh;RJY|Rajahmundry|Andhra Pradesh;
HWH|Howrah Junction|West Bengal;SDAH|Sealdah|West Bengal;KOAA|Kolkata (Chitpur)|West Bengal;NJP|New Jalpaiguri|West Bengal;SGUJ|Siliguri Junction|West Bengal;ASN|Asansol Junction|West Bengal;DGR|Durgapur|West Bengal;KGP|Kharagpur Junction|West Bengal;
BBS|Bhubaneswar|Odisha;PURI|Puri|Odisha;CTC|Cuttack|Odisha;SBP|Sambalpur|Odisha;
RNC|Ranchi Junction|Jharkhand;TATA|Tatanagar Junction|Jharkhand;DHN|Dhanbad Junction|Jharkhand;
PNBE|Patna Junction|Bihar;RJPB|Rajendra Nagar Terminal (Patna)|Bihar;DNR|Danapur|Bihar;GAYA|Gaya Junction|Bihar;MFP|Muzaffarpur Junction|Bihar;DBG|Darbhanga Junction|Bihar;
GHY|Guwahati|Assam;DBRG|Dibrugarh|Assam;SCL|Silchar|Assam;DMV|Dimapur|Nagaland;AGTL|Agartala|Tripura`
export const STATIONS = ST.replace(/\n/g, '').split(';').filter(Boolean).map((r) => { const [code, name, state] = r.split('|'); return { code, name, state } })

/** Find stations by code or part of the name/state. Exact code first, then names that start with the text, then names that contain it. */
export function searchStations(q, limit = 30) {
  const s = String(q).trim().toLowerCase()
  if (!s) return []
  const score = (st) => {
    const code = st.code.toLowerCase(), name = st.name.toLowerCase()
    if (code === s) return 0
    if (name.startsWith(s)) return 1
    if (code.startsWith(s)) return 2
    if (name.split(/[ ()]+/).some((w) => w.startsWith(s))) return 3
    if (name.includes(s)) return 4
    if (st.state.toLowerCase().startsWith(s)) return 5
    return 9
  }
  return STATIONS.map((st) => [score(st), st]).filter(([sc]) => sc < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(([, st]) => st)
}

export function checkPnr(raw) {
  const s = String(raw).replace(/[\s-]/g, '')
  if (!s) return { empty: true }
  if (!/^\d+$/.test(s)) return { ok: false, message: 'A PNR has digits only. Remove letters or symbols.' }
  if (s.length < 10) return { ok: false, message: `${s.length} of 10 digits so far.` }
  if (s.length > 10) return { ok: false, message: `A PNR has exactly 10 digits and this has ${s.length}.` }
  return { ok: true, pnr: s, message: 'Looks like a valid PNR: 10 digits.' }
}

const TYPES = [
  [/^0/, 'Special train (festival, summer or holiday special)'],
  [/^12[0-9]{3}$/, 'Superfast Mail/Express (includes Rajdhani, Shatabdi, Duronto and many long-distance trains)'],
  [/^20[0-9]{3}$/, 'Premium or semi-high-speed train (for example Vande Bharat, Tejas)'],
  [/^22[0-9]{3}$/, 'Superfast Mail/Express (newer series)'],
  [/^1[0-9]{4}$/, 'Long-distance Mail/Express'],
  [/^2[0-9]{4}$/, 'Superfast or premium train'],
  [/^3[0-9]{4}$/, 'Kolkata suburban (local EMU)'],
  [/^4[0-9]{4}$/, 'Suburban local in other metros (Chennai, Delhi, Hyderabad and similar)'],
  [/^5[0-9]{4}$/, 'Passenger train (slower, many stops)'],
  [/^6[0-9]{4}$/, 'MEMU or mainline electric train'],
  [/^7[0-9]{4}$/, 'DEMU or other short-distance train'],
  [/^8[0-9]{4}$/, 'Special or reserved series'],
  [/^9[0-9]{4}$/, 'Mumbai suburban local'],
]

export function checkTrain(raw) {
  const s = String(raw).replace(/\s/g, '')
  if (!s) return { empty: true }
  if (!/^\d+$/.test(s)) return { ok: false, message: 'A train number has digits only (5 digits, for example 12951).' }
  if (s.length !== 5) return { ok: false, message: `${s.length} of 5 digits so far.` }
  const kind = TYPES.find(([re]) => re.test(s))?.[1]
  return { ok: true, train: s, message: 'Valid train number format.', kind }
}

export const STATUS_GUIDE = [
  ['CNF', 'Confirmed. You have a berth or seat; coach and number are shown.'],
  ['RAC', 'Reservation Against Cancellation. You can board and share a berth; you move to a full berth if someone cancels.'],
  ['GNWL', 'General waiting list. The most likely to confirm. A low number means a better chance.'],
  ['RLWL', 'Remote location waiting list, for stations along the route. Confirms less often than GNWL.'],
  ['PQWL', 'Pooled quota waiting list, for shorter stretches that share a quota.'],
  ['RSWL', 'Roadside station waiting list.'],
  ['TQWL', 'Tatkal quota waiting list.'],
  ['REGRET / WL not available', 'The waiting list is full: no more bookings are taken.'],
  ['Chart prepared', 'The first chart is made several hours before departure (earlier for morning trains) and a final one close to departure. A waiting-list ticket that did not confirm is cancelled and refunded.'],
]
