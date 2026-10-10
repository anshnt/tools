// Formula engine self-check: node packs/studio-sheets/_selftest.mjs
import { Model } from './_model.js'
import { ck, parseCell } from './_a1.js'
import { XErr } from './_val.js'
import { FUNCS } from './_funcs.js'

let fails = 0
const m = new Model()
const sh = m.sheets[0]
const put = (a, t, s = sh) => { const p = parseCell(a); m.tx('set', () => m.setInput(s, p.r, p.c, t)) }
const val = (a, s = sh) => { const p = parseCell(a); return m.valueAt(s.id, p.r, p.c) }
const show = (v) => (v instanceof XErr ? v.code : Array.isArray(v) ? JSON.stringify(v) : v)
const eq = (a, want, msg = '') => {
  const got = show(val(a))
  const ok = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) < 1e-6 * Math.max(1, Math.abs(want)) : got === want
  if (!ok) { fails++; console.log(`FAIL ${a} ${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)} (=${m.getCellText(sh, parseCell(a).r, parseCell(a).c)})`) }
}
const f = (expr, want) => { put('Z99', '=' + expr); eq('Z99', want, expr) }

for (let i = 1; i <= 10; i++) { put('A' + i, String(i)); put('B' + i, i % 2 ? 'odd' : 'even'); put('C' + i, String(i * 10)) }
put('D1', 'Name'); ;['Ann', 'Bob', 'Cy'].forEach((n, i) => { put('D' + (i + 2), n); put('E' + (i + 2), String((i + 1) * 100)) })
f('SUM(A1:A10)', 55); f('AVERAGE(A1:A10)', 5.5); f('MIN(A1:A10)', 1); f('MAX(C1:C10)', 100); f('COUNT(A1:B10)', 10); f('COUNTA(A1:B10)', 20)
f('IF(A1>0,"pos","neg")', 'pos'); f('IFS(A1>5,"big",A1>0,"small")', 'small'); f('AND(A1>0,A2>1)', true); f('OR(A1>5,A2>5)', false); f('NOT(TRUE)', false)
f('ROUND(2.345,2)', 2.35); f('ROUND(-2.5,0)', -3); f('ABS(-4)', 4); f('SUMIF(B1:B10,"odd",A1:A10)', 25); f('SUMIFS(A1:A10,B1:B10,"even",A1:A10,">4")', 24)
f('COUNTIF(A1:A10,">5")', 5); f('COUNTIFS(B1:B10,"odd",A1:A10,"<6")', 3); f('AVERAGEIF(B1:B10,"even",A1:A10)', 6)
f('VLOOKUP("Bob",D2:E4,2,FALSE)', 200); f('VLOOKUP(5,A1:C10,3,FALSE)', 50); f('VLOOKUP(5.5,A1:C10,3)', 50); f('VLOOKUP("zz",D2:E4,2,FALSE)', '#N/A')
f('HLOOKUP(1,A1:C2,2,FALSE)', 2)
f('XLOOKUP("Cy",D2:D4,E2:E4)', 300); f('XLOOKUP("none",D2:D4,E2:E4,"nf")', 'nf'); f('XLOOKUP(250,E2:E4,D2:D4,,-1)', 'Bob')
f('INDEX(A1:C10,3,2)', 'odd'); f('MATCH("Bob",D2:D4,0)', 2); f('MATCH(4.5,A1:A10,1)', 4); f('INDEX(D2:D4,MATCH(300,E2:E4,0))', 'Cy')
f('CONCAT("a","b",1)', 'ab1'); f('LEFT("hello",2)', 'he'); f('RIGHT("hello",3)', 'llo'); f('MID("hello",2,3)', 'ell'); f('LEN("abc")', 3); f('TRIM("  a   b ")', 'a b')
f('UPPER("a")&LOWER("B")', 'Ab'); f('TEXT(1234.5,"#,##0.00")', '1,234.50'); f('TEXT(0.256,"0.0%")', '25.6%'); f('TEXT(DATE(2025,1,17),"dd-mmm-yyyy")', '17-Jan-2025')
f('DATE(2025,1,17)', 45674); f('YEAR(45674)', 2025); f('MONTH(45674)', 1); f('DAY(45674)', 17); f('EDATE(45674,1)', 45705); f('EOMONTH(45674,0)', 45688)
f('WEEKDAY(45674)', 6); f('DATEDIF(45674,45705,"d")', 31); f('NETWORKDAYS(45674,45688)', 11); f('DAYS(45688,45674)', 14)
f('PMT(0.08/12,60,10000)', -202.76394288); f('FV(0.05,10,-100)', 1257.789); f('PV(0.05,10,-100)', 772.1735); f('NPER(0.01,-100,1000)', 10.58864446); f('RATE(60,-202.7637,10000)', 0.0066667)
f('IPMT(0.08/12,1,60,10000)', -66.6667); f('PPMT(0.08/12,1,60,10000)', -136.09727622); f('NPV(0.1,100,100,100)', 248.6852); f('IRR(F1:F4)', '#NUM!')
f('SUMPRODUCT(A1:A3,C1:C3)', 140); f('SUMPRODUCT((A1:A10>5)*(C1:C10))', 400); f('MEDIAN(A1:A10)', 5.5); f('STDEV(A1:A5)', 1.5811388); f('LARGE(A1:A10,2)', 9); f('RANK(3,A1:A10)', 8)
f('IFERROR(1/0,"x")', 'x'); f('1/0', '#DIV/0!'); f('ISNUMBER(A1)', true); f('ISBLANK(Q1)', true); f('ISERROR(1/0)', true); f('N("a")', 0)
f('CHOOSE(2,"a","b","c")', 'b'); f('SWITCH(2,1,"one",2,"two","other")', 'two'); f('ROW(A5)', 5); f('COLUMN(C1)', 3); f('ROWS(A1:A10)', 10)
f('SUBSTITUTE("a-b-c","-","+")', 'a+b+c'); f('FIND("b","abc")', 2); f('SEARCH("B*","abc")', 2); f('TEXTJOIN(",",TRUE,D2:D4)', 'Ann,Bob,Cy'); f('REPT("ab",3)', 'ababab'); f('PROPER("hello wORLD")', 'Hello World')
f('MOD(-3,5)', 2); f('POWER(2,10)', 1024); f('SQRT(16)', 4); f('INT(-1.5)', -2); f('CEILING(2.1,0.5)', 2.5); f('FLOOR(2.7,0.5)', 2.5); f('GCD(12,18)', 6); f('LCM(4,6)', 12); f('FACT(5)', 120)
f('-2^2', 4); f('2^3^2', 64); f('50%*2', 1); f('"a"&1+1', 'a2'); f('1<2', true); f('"a"="A"', true); f('"b">"a"', true)
f('SUM(A1:A3)*2', 12); f('SUM(Sheet1!A1:A3)', 6)
// semantics worth pinning down
f('TEXT(1234567.891,"#,##0.00")', '1,234,567.89'); f('TEXT(0.5,"0%")', '50%'); f('TEXT(45674,"mmm d, yyyy")', 'Jan 17, 2025'); f('TEXT(45674.5,"hh:mm AM/PM")', '12:00 PM'); f('TEXT(-5,"0;(0)")', '(5)')
f('ROUND(1234.5678,-2)', 1200); f('ROUND(-1.5,0)', -2); f('MOD(-7,3)', 2); f('CEILING(-2.5,-2)', -4); f('CEILING(-2.5,2)', -2); f('CEILING(2.1,1)', 3); f('FLOOR(-2.5,2)', -4); f('TRUNC(-1.567,2)', -1.56); f('ROUNDUP(-1.01,1)', -1.1)
f('SUMPRODUCT(--(A1:A5>2))', 3); f('COUNTIF(B1:B5,"<>")', 5); f('COUNTIF(B1:B10,"o*")', 5); f('SUMIF(A1:A10,">=8")', 27); f('MATCH("b",{"a","b","c"},0)', 2); f('VLOOKUP(2,{1,"a";2,"b"},2,FALSE)', 'b')
f('"5"+1', 6); f('1&2', '12'); f('LEFT(12345,2)', '12'); f('AND(TRUE,"x")', '#VALUE!'); f('0.1+0.2=0.3', true); f('IF(1,"y")', 'y'); f('IF(0,"y")', false)
f('DATE(2025,14,1)', 46054); f('EOMONTH(DATE(2024,1,31),1)', 45351); f('WEEKNUM(DATE(2025,1,1))', 1); f('ISOWEEKNUM(DATE(2025,12,29))', 1); f('NETWORKDAYS(DATE(2025,1,1),DATE(2025,1,31))', 23); f('DATEDIF(DATE(2020,2,29),DATE(2025,2,28),"Y")', 4)
f('XLOOKUP(25,A1:A10,B1:B10,"-",-1)', 'even'); f('XLOOKUP(4,A1:A10,B1:B10,"-",1)', 'even'); f('XLOOKUP("o*",B1:B10,A1:A10,"-",2)', 1); f('IFERROR(VLOOKUP(99,A1:C10,2,FALSE),"none")', 'none'); f('IFNA(NA(),"x")', 'x')
f('TEXTJOIN("-",TRUE,A1:A3,"")', '1-2-3'); f('SUBSTITUTE("aaa","a","b",2)', 'aba'); f('PROPER("hello wORLD")', 'Hello World'); f('TRIM(" a  b ")', 'a b'); f('REPLACE("abcdef",2,3,"X")', 'aXef'); f('CHAR(65)&CODE("a")', 'A97')
f('PERCENTILE(A1:A10,0.5)', 5.5); f('QUARTILE(A1:A10,1)', 3.25); f('VAR(A1:A5)', 2.5); f('STDEVP(A1:A5)', 1.41421356); f('MEDIAN(A1:A4)', 2.5); f('MODE(A1:A3,1)', 1); f('LARGE(A1:A10,1)', 10)
f('FV(0.05/12,24,-100,0,1)', 2529.0862); f('PV(0.08/12,60,-500)', 24659.2167); f('SLN(1000,100,9)', 100); f('NPV(0.1,-1000,300,400,500)', -19.12437675); f('CUMIPMT(0.1/12,24,10000,1,12,0)', -786.14969)
// scalar arguments given as cell references
put('Y1', '3'); put('Y2', '2')
f('RANK(A3,A1:A10)', 8); f('LARGE(A1:A10,Y1)', 8); f('VLOOKUP(A5,A1:C10,Y1,FALSE)', 50); f('INDEX(A1:C10,Y2,Y1)', 20); f('MATCH(A4,A1:A10,Y1-3)', 4); f('ROUND(A1/3,Y2)', 0.33); f('SMALL(A1:A10,Y2)', 2)
// whole column and cross sheet
const s2 = m.tx('sheet', () => { const a = m.addSheetRaw('Data 2'); m.setSheets([...m.sheets]); return a })
put('A1', '5', s2); put('A2', '7', s2); put('B1', "=SUM('Data 2'!A:A)")
eq('B1', 12, 'cross sheet col')
put('A1', '10', s2); eq('B1', 17, 'recalc cross sheet')
// dependency chain + undo
put('G1', '1'); for (let i = 2; i <= 400; i++) put('G' + i, `=G${i - 1}+1`)
eq('G400', 400, 'long chain'); put('G1', '101'); eq('G400', 500, 'chain recalc')
m.undo(); eq('G400', 400, 'undo'); m.redo(); eq('G400', 500, 'redo')
// circular
put('H1', '=H2'); put('H2', '=H1'); eq('H1', '#CIRC!', 'circular'); put('H2', '5'); eq('H1', 5, 'cycle cleared')
// spill
put('J1', '=SEQUENCE(3,2)'); eq('J1', 1); eq('K1', 2); eq('J3', 5); eq('K3', 6)
put('J2', 'x'); eq('J1', '#SPILL!'); put('J2', ''); eq('J1', 1); eq('J2', 3)
put('M1', '=SORT(C1:C3,1,-1)'); eq('M1', 30); eq('M3', 10)
put('N1', '=SUM(M1:M3)'); eq('N1', 60); put('C1', '100'); eq('M1', 100); eq('N1', 150, 'dep on spill')
put('O1', '=UNIQUE(B2:B10)'); eq('O1', 'even'); eq('O2', 'odd')
put('P1', '=FILTER(A1:A10,A1:A10>8)'); eq('P1', 9); eq('P2', 10)
put('Q1', '=TRANSPOSE(A1:C1)'); eq('Q2', 17); eq('Q3', 100)
put('S1', '=A1:A3*2'); eq('S1', 2); eq('S3', 6)
put('T1', '12/05/2025'); eq('T1', 45789)
put('T2', '50%'); eq('T2', 0.5)
// ---- operations ----
const ops = await import('./_ops.js')
const m3 = new Model(); const w = m3.sheets[0]
const set3 = (a, t) => { const p = parseCell(a); m3.tx('s', () => m3.setInput(w, p.r, p.c, t)) }
const v3 = (a) => { const p = parseCell(a); return show(m3.valueAt(w.id, p.r, p.c)) }
const chk = (a, want, msg) => { const got = v3(a); if (got !== want) { fails++; console.log(`FAIL ops ${msg || ''} ${a}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) } }
;['5', '3', '9', '1'].forEach((x, i) => { set3('A' + (i + 1), x); set3('B' + (i + 1), `=A${i + 1}*2`) })
set3('C1', '=SUM(A1:A4)')
m3.tx('insert', () => ops.structural(m3, w, 'row', 1, 2, false))
chk('A4', 3, 'insert moved'); chk('B4', 6, 'insert shifted formula'); chk('C1', 18, 'range expanded'); 
if (m3.getCellText(w, 0, 2) !== '=SUM(A1:A6)') { fails++; console.log('FAIL insert text', m3.getCellText(w, 0, 2)) }
m3.undo(); chk('A3', 9, 'undo insert'); if (m3.getCellText(w, 0, 2) !== '=SUM(A1:A4)') { fails++; console.log('FAIL undo insert text') }
m3.tx('del', () => ops.structural(m3, w, 'row', 1, 1, true)); chk('A2', 9, 'delete'); chk('C1', 15, 'delete range'); chk('B2', 18, 'delete formula')
m3.tx('delcol', () => ops.structural(m3, w, 'col', 0, 1, true)); chk('A1', '#REF!', 'del col formula moved')
m3.undo(); m3.undo()
m3.tx('sort', () => ops.sortRect(m3, w, { r1: 0, c1: 0, r2: 3, c2: 1 }, [{ col: 0, desc: false }], false))
chk('A1', '1'.length && 1, 'sort'); chk('B1', 2, 'sort formula follows'); chk('A4', 9)
m3.undo()
set3('E1', '1'); set3('E2', '3')
m3.tx('fill', () => ops.fillExtend(m3, w, { r1: 0, c1: 4, r2: 1, c2: 4 }, { r1: 0, c1: 4, r2: 4, c2: 4 }))
chk('E3', 5, 'fill series'); chk('E5', 9)
set3('F1', 'Jan'); m3.tx('fill', () => ops.fillExtend(m3, w, { r1: 0, c1: 5, r2: 0, c2: 5 }, { r1: 0, c1: 5, r2: 3, c2: 5 })); chk('F2', 'Feb'); chk('F4', 'Apr')
set3('G1', 'Item 1'); m3.tx('fill', () => ops.fillExtend(m3, w, { r1: 0, c1: 6, r2: 0, c2: 6 }, { r1: 0, c1: 6, r2: 2, c2: 6 })); chk('G3', 'Item 3')
m3.tx('fillf', () => ops.fillExtend(m3, w, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 3, c2: 1 })); chk('B4', 2)
const pay = ops.copyPayload(m3, w, { r1: 0, c1: 0, r2: 3, c2: 1 })
m3.tx('paste', () => ops.pasteCells(m3, w, 0, 8, pay, 'all')); chk('J2', 6, 'paste shifted formula'); if (m3.getCellText(w, 1, 9) !== '=I2*2') { fails++; console.log('FAIL paste text', m3.getCellText(w, 1, 9)) }
w.filter = { r1: 0, c1: 0, r2: 3, c2: 0, cols: { 0: { hide: ['3'] } } }; m3.tx('filter', () => ops.applyFilter(m3, w)); if (!w.fHide[1]) { fails++; console.log('FAIL filter hide', JSON.stringify(w.fHide)) }
const hits = ops.findAll(m3, { text: 'item', sheet: w }); if (hits.length < 1) { fails++; console.log('FAIL find') }
// ---- defined names ----
const m4 = new Model(); const n4 = m4.sheets[0]
const set4 = (a, t) => { const p = parseCell(a); m4.tx('s', () => m4.setInput(n4, p.r, p.c, t)) }
const v4 = (a) => { const p = parseCell(a); return show(m4.valueAt(n4.id, p.r, p.c)) }
set4('A1', '5'); set4('A2', '7'); set4('A3', '9')
m4.tx('name', () => m4.setName('Vals', 'Sheet1!$A$1:$A$3'))
set4('C1', '=SUM(Vals)*2'); if (v4('C1') !== 42) { fails++; console.log('FAIL name sum', v4('C1')) }
set4('A2', '10'); if (v4('C1') !== 48) { fails++; console.log('FAIL name recalc', v4('C1')) }
m4.tx('ins', () => ops.structural(m4, n4, 'row', 0, 1, false)); if (v4('C2') !== 48 || m4.wb.names.VALS.ref !== 'Sheet1!$A$2:$A$4') { fails++; console.log('FAIL name insert', v4('C2'), m4.wb.names.VALS.ref) }
m4.undo(); if (m4.wb.names.VALS.ref !== 'Sheet1!$A$1:$A$3') { fails++; console.log('FAIL name undo') }
set4('D1', '=Nope'); if (v4('D1') !== '#NAME?') { fails++; console.log('FAIL unknown name', v4('D1')) }
if (Model.fromJSON(JSON.parse(JSON.stringify(m4.toJSON()))).wb.names.VALS.ref !== 'Sheet1!$A$1:$A$3') { fails++; console.log('FAIL name json') }
const j = JSON.parse(JSON.stringify(m.toJSON()))
const m2 = Model.fromJSON(j)
const v2 = (a) => { const p = parseCell(a); return show(m2.valueAt(m2.sheets[0].id, p.r, p.c)) }
if (v2('G400') !== 500 || v2('B1') !== 17 || v2('M1') !== 100) { fails++; console.log('FAIL roundtrip', v2('G400'), v2('B1'), v2('M1')) }
const names = Object.keys(FUNCS).length
if (names < 150) { fails++; console.log('FAIL function count', names) }
console.log(fails ? `${fails} failure(s)` : `ok - engine self-check passed (${names} functions)`)
process.exitCode = fails ? 1 : 0
