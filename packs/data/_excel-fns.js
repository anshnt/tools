// Dictionary of Excel functions: NAME | category | what it does | arguments | plain-English phrase.
// Arguments are "name:meaning" separated by ";". [name] is optional, a trailing "..." means "more of these".
// Phrases use {1} for argument 1, {*} for all arguments, {2..} for argument 2 onwards, and [[ ... ]] for text that appears only when its arguments exist.
const RAW = `
SUM|math|Adds numbers, cells and ranges.|number1:First number, cell or range;[number2]...:More numbers, cells or ranges|the total of {*}
SUMIF|math|Adds the cells that meet one condition.|range:Cells to test;criteria:The condition, such as ">10" or "North";[sum_range]:Cells to add (uses range when left out)|the total of [[{3}]][[the cells in {1}]] where {1} matches {2}
SUMIFS|math|Adds the cells that meet several conditions at once.|sum_range:Cells to add;criteria_range1:First range to test;criteria1:First condition;[criteria_range2]...:More ranges and conditions in pairs|the total of {1} for rows where {2} matches {3}[[ and {p4}]]
SUMPRODUCT|math|Multiplies matching items of ranges and adds the results.|array1:First range;[array2]...:More ranges of the same size|the sum of the matching items of {*} multiplied together
PRODUCT|math|Multiplies numbers together.|number1:First number or range;[number2]...:More numbers|{*} multiplied together
ROUND|math|Rounds a number to a number of decimal places.|number:The number;num_digits:Decimal places (0 for whole numbers, negative for tens, hundreds)|{1} rounded to {2} decimal places
ROUNDUP|math|Rounds a number up, away from zero.|number:The number;num_digits:Decimal places|{1} rounded up to {2} decimal places
ROUNDDOWN|math|Rounds a number down, toward zero.|number:The number;num_digits:Decimal places|{1} rounded down to {2} decimal places
MROUND|math|Rounds to the nearest multiple.|number:The number;multiple:The multiple to round to|{1} rounded to the nearest multiple of {2}
CEILING|math|Rounds up to the nearest multiple.|number:The number;significance:The multiple to round up to|{1} rounded up to the next multiple of {2}
FLOOR|math|Rounds down to the nearest multiple.|number:The number;significance:The multiple to round down to|{1} rounded down to the previous multiple of {2}
INT|math|Rounds down to the nearest whole number.|number:The number|the whole-number part of {1}, rounded down
TRUNC|math|Cuts off the decimals without rounding.|number:The number;[num_digits]:Decimals to keep (0 by default)|{1} cut off [[after {2} decimals ]]without rounding
ABS|math|Gives the absolute value (drops the minus sign).|number:The number|the size of {1}, ignoring its sign
MOD|math|Gives the remainder after division.|number:The number to divide;divisor:The number to divide by|the remainder of {1} divided by {2}
POWER|math|Raises a number to a power.|number:The base;power:The exponent|{1} raised to the power of {2}
SQRT|math|Gives the square root.|number:A number zero or higher|the square root of {1}
EXP|math|Gives e raised to a power.|number:The exponent|e raised to the power of {1}
LN|math|Gives the natural logarithm.|number:A positive number|the natural logarithm of {1}
LOG|math|Gives the logarithm to a base.|number:A positive number;[base]:The base (10 by default)|the logarithm of {1}[[ in base {2}]]
LOG10|math|Gives the base-10 logarithm.|number:A positive number|the base-10 logarithm of {1}
PI|math|Gives the number pi (3.14159...).||the number pi
RAND|math|Gives a random decimal between 0 and 1 (changes on every recalculation).||a random decimal between 0 and 1
RANDBETWEEN|math|Gives a random whole number between two numbers.|bottom:Smallest number;top:Largest number|a random whole number from {1} to {2}
SIGN|math|Tells if a number is positive (1), zero (0) or negative (-1).|number:The number|the sign of {1} (1, 0 or -1)
QUOTIENT|math|Gives the whole-number part of a division.|numerator:The number to divide;denominator:The number to divide by|the whole part of {1} divided by {2}
GCD|math|Gives the greatest common divisor.|number1:First number;[number2]...:More numbers|the greatest common divisor of {*}
LCM|math|Gives the least common multiple.|number1:First number;[number2]...:More numbers|the least common multiple of {*}
FACT|math|Gives the factorial of a number.|number:A whole number zero or higher|the factorial of {1}
COMBIN|math|Counts the ways to choose items, ignoring order.|number:Total items;number_chosen:Items to pick|the number of ways to choose {2} items from {1}
SUBTOTAL|math|Calculates a total that can ignore hidden or filtered rows.|function_num:Which calculation (9 or 109 = sum, 1 or 101 = average, 2 or 102 = count);ref1:First range;[ref2]...:More ranges|a subtotal of {2..}, calculation {1}
AGGREGATE|math|Like SUBTOTAL, with options to skip errors and hidden rows.|function_num:Which calculation (1 to 19);options:What to ignore (6 ignores errors);ref1:First range;[ref2]...:More ranges or the k value|an aggregate of {3..}, calculation {1}, option {2}
AVERAGE|stats|Gives the average (mean) of numbers.|number1:First number or range;[number2]...:More numbers or ranges|the average of {*}
AVERAGEIF|stats|Averages the cells that meet one condition.|range:Cells to test;criteria:The condition;[average_range]:Cells to average (uses range when left out)|the average of [[{3}]][[the cells in {1}]] where {1} matches {2}
AVERAGEIFS|stats|Averages the cells that meet several conditions.|average_range:Cells to average;criteria_range1:First range to test;criteria1:First condition;[criteria_range2]...:More ranges and conditions|the average of {1} for rows where {2} matches {3}[[ and {p4}]]
COUNT|stats|Counts the cells that contain numbers.|value1:First value or range;[value2]...:More values or ranges|how many numbers there are in {*}
COUNTA|stats|Counts the cells that are not empty.|value1:First value or range;[value2]...:More values or ranges|how many non-empty cells there are in {*}
COUNTBLANK|stats|Counts the empty cells in a range.|range:The range to check|how many empty cells there are in {1}
COUNTIF|stats|Counts the cells that meet one condition.|range:Cells to test;criteria:The condition, such as ">10" or "North"|how many cells in {1} match {2}
COUNTIFS|stats|Counts the rows that meet several conditions.|criteria_range1:First range to test;criteria1:First condition;[criteria_range2]...:More ranges and conditions in pairs|how many rows have {1} matching {2}[[ and {p3}]]
MAX|stats|Gives the largest number.|number1:First number or range;[number2]...:More numbers or ranges|the largest of {*}
MIN|stats|Gives the smallest number.|number1:First number or range;[number2]...:More numbers or ranges|the smallest of {*}
MAXIFS|stats|Gives the largest number that meets conditions.|max_range:Cells to look in;criteria_range1:Range to test;criteria1:The condition;[criteria_range2]...:More ranges and conditions|the largest value in {1} where {2} matches {3}[[ and {p4}]]
MINIFS|stats|Gives the smallest number that meets conditions.|min_range:Cells to look in;criteria_range1:Range to test;criteria1:The condition;[criteria_range2]...:More ranges and conditions|the smallest value in {1} where {2} matches {3}[[ and {p4}]]
MEDIAN|stats|Gives the middle value.|number1:First number or range;[number2]...:More numbers or ranges|the median (middle value) of {*}
MODE.SNGL|stats|Gives the most frequent number.|number1:First number or range;[number2]...:More numbers|the most frequent number in {*}
STDEV.S|stats|Gives the standard deviation of a sample.|number1:First number or range;[number2]...:More numbers|the sample standard deviation of {*}
STDEV.P|stats|Gives the standard deviation of a whole population.|number1:First number or range;[number2]...:More numbers|the population standard deviation of {*}
VAR.S|stats|Gives the variance of a sample.|number1:First number or range;[number2]...:More numbers|the sample variance of {*}
VAR.P|stats|Gives the variance of a whole population.|number1:First number or range;[number2]...:More numbers|the population variance of {*}
LARGE|stats|Gives the k-th largest value.|array:The range;k:Position from the top (1 = largest)|the {2}-th largest value in {1}
SMALL|stats|Gives the k-th smallest value.|array:The range;k:Position from the bottom (1 = smallest)|the {2}-th smallest value in {1}
RANK.EQ|stats|Gives the rank of a number in a list.|number:The value to rank;ref:The list of numbers;[order]:0 or left out for largest first, 1 for smallest first|the rank of {1} within {2}
PERCENTILE.INC|stats|Gives the value at a percentile.|array:The data;k:Percentile from 0 to 1 (0.9 = 90th)|the value at the {2} percentile of {1}
QUARTILE.INC|stats|Gives a quartile of the data.|array:The data;quart:0 min, 1 first quartile, 2 median, 3 third quartile, 4 max|quartile {2} of {1}
CORREL|stats|Gives the correlation between two data sets.|array1:First range;array2:Second range|how closely {1} and {2} move together (their correlation)
SLOPE|stats|Gives the slope of the best-fit line.|known_ys:The Y values;known_xs:The X values|the slope of the best-fit line of {1} against {2}
INTERCEPT|stats|Gives where the best-fit line crosses the Y axis.|known_ys:The Y values;known_xs:The X values|where the best-fit line of {1} against {2} crosses the Y axis
FORECAST.LINEAR|stats|Predicts a value along a straight-line trend.|x:The X to predict for;known_ys:The Y values;known_xs:The X values|the predicted value at {1} from the straight-line trend of {2} against {3}
IF|logical|Returns one value if a test is true and another if it is false.|logical_test:The condition to check;value_if_true:Result when true;[value_if_false]:Result when false (FALSE if left out)|{2}, if {1}[[, otherwise {3}]]
IFS|logical|Checks conditions in order and returns the first match.|logical_test1:First condition;value_if_true1:Result for the first condition;[logical_test2]...:More condition and result pairs|the result of the first condition that is true, checking in order: {*}
IFERROR|logical|Returns a fallback value if the formula gives an error.|value:The formula to try;value_if_error:What to show when it errors|{1}, or {2} if that gives an error
IFNA|logical|Returns a fallback value only for #N/A errors.|value:The formula to try;value_if_na:What to show for #N/A|{1}, or {2} if that is #N/A
AND|logical|True only when every condition is true.|logical1:First condition;[logical2]...:More conditions|all of these are true: {*}
OR|logical|True when at least one condition is true.|logical1:First condition;[logical2]...:More conditions|at least one of these is true: {*}
NOT|logical|Flips true to false and false to true.|logical:The condition|{1} is not true
XOR|logical|True when an odd number of conditions are true.|logical1:First condition;[logical2]...:More conditions|exactly one (or an odd number) of {*} is true
TRUE|logical|The logical value TRUE.||TRUE
FALSE|logical|The logical value FALSE.||FALSE
SWITCH|logical|Compares a value with a list and returns the matching result.|expression:The value to compare;value1:First value to match;result1:Result for the first match;[default_or_value2]...:More pairs, and an optional default last|the result that goes with {1} in the list {2..}
VLOOKUP|lookup|Finds a value in the first column of a table and returns a value from the same row.|lookup_value:The value to find;table_array:The table (the value must be in its first column);col_index_num:Which column of the table to return (1 = first);[range_lookup]:FALSE for exact match, TRUE or left out for approximate|the value from column {3} of the row in {2} whose first column matches {1}[[, with {4} choosing exact or approximate matching]]
HLOOKUP|lookup|Finds a value in the top row of a table and returns a value from the same column.|lookup_value:The value to find;table_array:The table (the value must be in its first row);row_index_num:Which row of the table to return;[range_lookup]:FALSE for exact match|the value from row {3} of the column in {2} whose first row matches {1}
XLOOKUP|lookup|Finds a value in one range and returns the matching item from another.|lookup_value:The value to find;lookup_array:Where to search;return_array:Where to take the result from;[if_not_found]:Text to show when nothing matches;[match_mode]:0 exact, -1 exact or smaller, 1 exact or larger, 2 wildcard;[search_mode]:1 first to last, -1 last to first|the item in {3} that sits next to {1} in {2}[[, or {4} if it is not found]]
XMATCH|lookup|Gives the position of a value in a range.|lookup_value:The value to find;lookup_array:Where to search;[match_mode]:0 exact, -1, 1 or 2;[search_mode]:1 first to last, -1 last to first|the position of {1} in {2}
LOOKUP|lookup|Looks up a value in a sorted range (older, simple version).|lookup_value:The value to find;lookup_vector:A sorted range to search;[result_vector]:The range to take the result from|the match for {1} in {2}[[ taken from {3}]]
MATCH|lookup|Gives the position of a value in a range.|lookup_value:The value to find;lookup_array:The range to search;[match_type]:0 exact, 1 largest not above (sorted), -1 smallest not below (sorted)|the position of {1} in {2}[[, match type {3}]]
INDEX|lookup|Returns the item at a given position of a range.|array:The range;row_num:Row position;[column_num]:Column position;[area_num]:Which area when the range has several|the item in {1} at row {2}[[ and column {3}]]
OFFSET|lookup|Returns a range that is shifted from a starting cell (volatile).|reference:Starting cell;rows:Rows to move down (negative = up);cols:Columns to move right;[height]:Rows in the result;[width]:Columns in the result|the range found by moving {2} rows and {3} columns from {1}
INDIRECT|lookup|Turns text into a cell reference (volatile).|ref_text:Text such as "A1" or "Sheet2!B5";[a1]:TRUE for A1 style (default)|the cell or range named by the text {1}
CHOOSE|lookup|Picks one value from a list by position.|index_num:Which value to pick (1 = first);value1:First choice;[value2]...:More choices|item number {1} from the list {2..}
ROW|lookup|Gives the row number of a cell.|[reference]:A cell (the current cell when left out)|the row number of [[{1}]][[this cell]]
COLUMN|lookup|Gives the column number of a cell.|[reference]:A cell (the current cell when left out)|the column number of [[{1}]][[this cell]]
ROWS|lookup|Counts the rows in a range.|array:The range|the number of rows in {1}
COLUMNS|lookup|Counts the columns in a range.|array:The range|the number of columns in {1}
ADDRESS|lookup|Builds a cell address as text.|row_num:Row number;column_num:Column number;[abs_num]:1 absolute, 2, 3, 4 relative;[a1]:TRUE for A1 style;[sheet_text]:Sheet name|the address text for row {1}, column {2}
HYPERLINK|lookup|Makes a clickable link.|link_location:The web address or cell to open;[friendly_name]:The text to show|a link to {1}[[ that shows {2}]]
TRANSPOSE|lookup|Flips rows and columns of a range.|array:The range|{1} with its rows and columns swapped
FILTER|array|Returns only the rows that meet a condition (Microsoft 365).|array:The data;include:A TRUE/FALSE test for each row;[if_empty]:What to show when nothing matches|the rows of {1} where {2} is true[[, or {3} if there are none]]
SORT|array|Sorts a range (Microsoft 365).|array:The data;[sort_index]:Column to sort by;[sort_order]:1 ascending, -1 descending;[by_col]:TRUE to sort columns|{1} sorted[[ by column {2}]]
SORTBY|array|Sorts a range by another range (Microsoft 365).|array:The data;by_array1:Range to sort by;[sort_order1]:1 ascending, -1 descending;[by_array2]...:More sort keys|{1} sorted by {2..}
UNIQUE|array|Returns the distinct values of a range (Microsoft 365).|array:The data;[by_col]:TRUE to compare columns;[exactly_once]:TRUE to keep only values that appear once|the different values in {1}
SEQUENCE|array|Creates a list of numbers (Microsoft 365).|rows:How many rows;[columns]:How many columns;[start]:First number;[step]:Gap between numbers|a grid of {1} rows of numbers[[ starting at {3}]]
RANDARRAY|array|Creates a grid of random numbers (Microsoft 365).|[rows]:Rows;[columns]:Columns;[min]:Smallest;[max]:Largest;[whole_number]:TRUE for whole numbers|a grid of random numbers
TAKE|array|Keeps the first or last rows and columns (Microsoft 365).|array:The data;rows:Rows to keep (negative = from the end);[columns]:Columns to keep|the first {2} rows of {1}
DROP|array|Removes rows and columns from the start or end (Microsoft 365).|array:The data;rows:Rows to remove;[columns]:Columns to remove|{1} without its first {2} rows
VSTACK|array|Stacks ranges on top of each other (Microsoft 365).|array1:First range;[array2]...:More ranges|{*} stacked on top of each other
HSTACK|array|Places ranges side by side (Microsoft 365).|array1:First range;[array2]...:More ranges|{*} placed side by side
TOCOL|array|Turns a range into one column (Microsoft 365).|array:The range;[ignore]:0 keep all, 1 skip blanks, 2 skip errors, 3 both;[scan_by_column]:TRUE to read down columns|{1} turned into a single column
TOROW|array|Turns a range into one row (Microsoft 365).|array:The range;[ignore]:0 keep all, 1 skip blanks, 2 skip errors, 3 both;[scan_by_column]:TRUE to read down columns|{1} turned into a single row
LET|array|Names values inside a formula so you can reuse them (Microsoft 365).|name1:First name;name_value1:Value for the first name;[name2]...:More names and values, then the calculation last|a calculation that gives names to values and then uses them
LAMBDA|array|Creates your own reusable function (Microsoft 365).|parameter1:A parameter name;[parameter2]...:More parameter names, then the calculation last|a custom function
MAP|array|Applies a function to every item of a range (Microsoft 365).|array1:The range;lambda_or_array:A LAMBDA to apply|a function applied to each item of {1}
REDUCE|array|Combines a range into one value using a function (Microsoft 365).|initial_value:The starting value;array:The range;lambda:A LAMBDA that combines two values|the items of {2} combined into one value, starting from {1}
SCAN|array|Like REDUCE but keeps every running result (Microsoft 365).|initial_value:The starting value;array:The range;lambda:A LAMBDA that combines two values|running results over {2}, starting from {1}
BYROW|array|Applies a function to each row (Microsoft 365).|array:The range;lambda:A LAMBDA that takes one row|a function applied to each row of {1}
BYCOL|array|Applies a function to each column (Microsoft 365).|array:The range;lambda:A LAMBDA that takes one column|a function applied to each column of {1}
TEXTSPLIT|text|Splits text into columns or rows at a delimiter (Microsoft 365).|text:The text;col_delimiter:Text to split columns at;[row_delimiter]:Text to split rows at;[ignore_empty]:TRUE to skip empty pieces;[match_mode]:0 case-sensitive, 1 not;[pad_with]:What to put in missing cells|{1} split at {2}
TEXTBEFORE|text|Returns the text before a delimiter (Microsoft 365).|text:The text;delimiter:The marker to look for;[instance_num]:Which occurrence (negative = from the end);[match_mode]:0 case-sensitive, 1 not;[match_end]:0 or 1;[if_not_found]:Value when missing|the text of {1} that comes before {2}
TEXTAFTER|text|Returns the text after a delimiter (Microsoft 365).|text:The text;delimiter:The marker to look for;[instance_num]:Which occurrence (negative = from the end);[match_mode]:0 case-sensitive, 1 not;[match_end]:0 or 1;[if_not_found]:Value when missing|the text of {1} that comes after {2}
TEXTJOIN|text|Joins text from many cells with a separator.|delimiter:Text to put between items;ignore_empty:TRUE to skip empty cells;text1:First text or range;[text2]...:More text or ranges|{3..} joined with {1} between each item
LEFT|text|Takes characters from the start of text.|text:The text;[num_chars]:How many characters (1 by default)|the first [[{2}]][[1]] characters of {1}
RIGHT|text|Takes characters from the end of text.|text:The text;[num_chars]:How many characters (1 by default)|the last [[{2}]][[1]] characters of {1}
MID|text|Takes characters from the middle of text.|text:The text;start_num:Position of the first character (1 = first);num_chars:How many characters|{3} characters of {1}, starting at character {2}
LEN|text|Counts the characters in text.|text:The text|the number of characters in {1}
FIND|text|Gives the position of text inside other text (case-sensitive).|find_text:The text to find;within_text:The text to search;[start_num]:Where to start|the position of {1} inside {2}
SEARCH|text|Gives the position of text inside other text (ignores case, allows wildcards).|find_text:The text to find;within_text:The text to search;[start_num]:Where to start|the position of {1} inside {2}, ignoring upper and lower case
SUBSTITUTE|text|Replaces matching text with new text.|text:The text;old_text:Text to replace;new_text:Replacement text;[instance_num]:Only replace this occurrence|{1} with {2} replaced by {3}[[, occurrence {4} only]]
REPLACE|text|Replaces part of text by position.|old_text:The text;start_num:Where to start;num_chars:How many characters to replace;new_text:Replacement text|{1} with {3} characters from position {2} replaced by {4}
TRIM|text|Removes extra spaces, keeping single spaces between words.|text:The text|{1} without extra spaces
CLEAN|text|Removes non-printing characters.|text:The text|{1} without non-printing characters
UPPER|text|Changes text to UPPERCASE.|text:The text|{1} in upper case
LOWER|text|Changes text to lowercase.|text:The text|{1} in lower case
PROPER|text|Capitalizes The First Letter Of Each Word.|text:The text|{1} with each word capitalized
CONCAT|text|Joins text and ranges together.|text1:First text or range;[text2]...:More text or ranges|{*} joined into one piece of text
CONCATENATE|text|Joins pieces of text together (older version of CONCAT).|text1:First text;[text2]...:More text|{*} joined into one piece of text
TEXT|text|Turns a value into text using a number format.|value:The number or date;format_text:The format, such as "0.00", "dd/mm/yyyy" or "mmmm"|{1} shown as text in the format {2}
VALUE|text|Turns text that looks like a number into a number.|text:The text|the text {1} turned into a number
NUMBERVALUE|text|Turns text into a number with chosen separators.|text:The text;[decimal_separator]:Decimal mark;[group_separator]:Thousands mark|the text {1} turned into a number
REPT|text|Repeats text a number of times.|text:The text;number_times:How many times|{1} repeated {2} times
EXACT|text|Checks if two texts are exactly the same (case-sensitive).|text1:First text;text2:Second text|{1} and {2} are exactly the same, including upper and lower case
CHAR|text|Gives the character for a code number.|number:Code from 1 to 255|the character with code {1}
CODE|text|Gives the code number of the first character.|text:The text|the code of the first character of {1}
UNICHAR|text|Gives the character for a Unicode number.|number:A Unicode number|the Unicode character {1}
DOLLAR|text|Formats a number as currency text.|number:The number;[decimals]:Decimal places|{1} shown as currency text
FIXED|text|Formats a number as text with fixed decimals.|number:The number;[decimals]:Decimal places;[no_commas]:TRUE to leave out thousands marks|{1} shown as text with fixed decimals
TODAY|date|Gives today's date (changes every day).||today's date
NOW|date|Gives the current date and time (changes constantly).||the current date and time
DATE|date|Builds a date from a year, month and day.|year:The year;month:The month (1 to 12);day:The day|the date for year {1}, month {2}, day {3}
DATEVALUE|date|Turns date text into a real date.|date_text:Text such as "2024-12-25"|the text {1} turned into a date
YEAR|date|Gives the year of a date.|serial_number:The date|the year of {1}
MONTH|date|Gives the month of a date (1 to 12).|serial_number:The date|the month number of {1}
DAY|date|Gives the day of the month.|serial_number:The date|the day of the month of {1}
HOUR|date|Gives the hour of a time.|serial_number:The time|the hour of {1}
MINUTE|date|Gives the minute of a time.|serial_number:The time|the minute of {1}
SECOND|date|Gives the second of a time.|serial_number:The time|the second of {1}
TIME|date|Builds a time from hour, minute and second.|hour:Hour;minute:Minute;second:Second|the time {1}:{2}:{3}
WEEKDAY|date|Gives the day of the week as a number.|serial_number:The date;[return_type]:1 Sunday=1 (default), 2 Monday=1, 3 Monday=0|the day of the week of {1} as a number
WEEKNUM|date|Gives the week number of the year.|serial_number:The date;[return_type]:Which day the week starts on|the week number of {1}
EOMONTH|date|Gives the last day of a month, some months away.|start_date:A date;months:Months to move (0 = same month, negative = earlier)|the last day of the month that is {2} months from {1}
EDATE|date|Moves a date by whole months.|start_date:A date;months:Months to add (negative = subtract)|{1} moved by {2} months
DATEDIF|date|Gives the difference between dates in years, months or days.|start_date:Earlier date;end_date:Later date;unit:"Y" years, "M" months, "D" days, "YM", "MD", "YD"|the difference between {1} and {2} in units of {3}
DAYS|date|Counts the days between two dates.|end_date:Later date;start_date:Earlier date|the number of days from {2} to {1}
NETWORKDAYS|date|Counts working days between two dates.|start_date:First date;end_date:Last date;[holidays]:Dates to skip|the number of working days between {1} and {2}
WORKDAY|date|Gives the date a number of working days away.|start_date:Starting date;days:Working days to add (negative = subtract);[holidays]:Dates to skip|the date that is {2} working days from {1}
YEARFRAC|date|Gives the years between two dates as a fraction.|start_date:First date;end_date:Last date;[basis]:Day-count method|the years between {1} and {2} as a fraction
ISOWEEKNUM|date|Gives the ISO week number.|date:The date|the ISO week number of {1}
PMT|financial|Gives the regular payment of a loan.|rate:Interest rate per period;nper:Number of payments;pv:Loan amount;[fv]:Balance wanted at the end (0);[type]:0 pay at end of period, 1 at start|the payment per period for a loan of {3} at {1} per period over {2} periods
FV|financial|Gives the future value of regular payments.|rate:Interest rate per period;nper:Number of periods;pmt:Payment each period;[pv]:Starting amount;[type]:0 end, 1 start|what {3} paid each period grows to over {2} periods at {1} per period
PV|financial|Gives the present value of regular payments.|rate:Interest rate per period;nper:Number of periods;pmt:Payment each period;[fv]:Value wanted at the end;[type]:0 end, 1 start|today's value of {2} payments of {3} at {1} per period
NPV|financial|Gives the net present value of cash flows.|rate:Discount rate per period;value1:First cash flow;[value2]...:More cash flows|the cash flows {2..} discounted at {1} to today's value
IRR|financial|Gives the internal rate of return.|values:Cash flows (at least one positive and one negative);[guess]:Starting guess|the internal rate of return of {1}
XIRR|financial|Gives the internal rate of return for dated cash flows.|values:Cash flows;dates:Matching dates;[guess]:Starting guess|the annual return of {1} paid on {2}
RATE|financial|Gives the interest rate per period.|nper:Number of periods;pmt:Payment each period;pv:Present value;[fv]:Future value;[type]:0 end, 1 start;[guess]:Starting guess|the interest rate per period
NPER|financial|Gives the number of payment periods.|rate:Interest rate per period;pmt:Payment each period;pv:Present value;[fv]:Future value;[type]:0 end, 1 start|the number of periods it takes
ISBLANK|info|True if the cell is empty.|value:The cell|{1} is empty
ISNUMBER|info|True if the value is a number.|value:The value|{1} is a number
ISTEXT|info|True if the value is text.|value:The value|{1} is text
ISERROR|info|True if the value is any error.|value:The value|{1} is an error
ISNA|info|True if the value is the #N/A error.|value:The value|{1} is #N/A
ISLOGICAL|info|True if the value is TRUE or FALSE.|value:The value|{1} is TRUE or FALSE
ISEVEN|info|True if the number is even.|number:The number|{1} is even
ISODD|info|True if the number is odd.|number:The number|{1} is odd
N|info|Turns a value into a number.|value:The value|{1} as a number
NA|info|Returns the #N/A error on purpose.||the #N/A error
`
export const VOLATILE = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN', 'RANDARRAY', 'OFFSET', 'INDIRECT'])
export const CATEGORIES = { math: 'Math', stats: 'Statistics', logical: 'Logical', lookup: 'Lookup', array: 'Dynamic arrays', text: 'Text', date: 'Date and time', financial: 'Financial', info: 'Information' }

function parse() {
  const out = new Map()
  for (const line of RAW.split('\n')) {
    if (!line.trim()) continue
    const [name, cat, desc, args = '', phrase = ''] = line.split('|')
    const list = args ? args.split(';').map((a) => {
      const i = a.indexOf(':')
      let n = a.slice(0, i), d = a.slice(i + 1)
      let optional = false, variadic = false
      if (n.endsWith('...')) { variadic = true; n = n.slice(0, -3) }
      if (n.startsWith('[') && n.endsWith(']')) { optional = true; n = n.slice(1, -1) }
      return { name: n, desc: d, optional, variadic }
    }) : []
    const required = list.filter((a) => !a.optional && !a.variadic).length
    const variadic = list.some((a) => a.variadic)
    out.set(name, { name, cat, desc, args: list, phrase, min: required, max: variadic ? Infinity : list.length, syntax: `${name}(${list.map((a) => (a.optional || a.variadic ? `[${a.name}${a.variadic ? ', ...' : ''}]` : a.name)).join(', ')})` })
  }
  return out
}
export const FUNCTIONS = parse()
/** Name lookup that understands _xlfn. prefixes and a few legacy aliases. */
export const ALIASES = { STDEV: 'STDEV.S', STDEVP: 'STDEV.P', VAR: 'VAR.S', VARP: 'VAR.P', MODE: 'MODE.SNGL', RANK: 'RANK.EQ', PERCENTILE: 'PERCENTILE.INC', QUARTILE: 'QUARTILE.INC', FORECAST: 'FORECAST.LINEAR' }
export const lookupFn = (name) => {
  const n = name.toUpperCase().replace(/^_XL(FN|WS)\./, '').replace(/^_XLFN\./, '')
  return FUNCTIONS.get(n) || FUNCTIONS.get(ALIASES[n])
}
