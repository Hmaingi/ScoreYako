// Intelligent workbook ingestion: sheet detection, column mapping, normalization,
// cross-sheet relationship discovery, and grouping. Parsing happens once (at preview
// time); the same parsed structure is persisted and later committed as-is so the
// reviewed import is exactly what gets written to the database.
// === Field Aliases Configuration ===
const fieldAliases = {
    customer_name: [
        'customer name', 'customername', 'client name', 'customer', 'client', 'debtor name', 'borrower name',
        'company name', 'company', 'legal name', 'entity name', 'account holder', 'holder name',
        'debtor', 'borrower', 'household name', 'account holder name'
    ],
    entity_type: [
        'entity type', 'customer type', 'party type', 'business or individual', 'business type', 'account type category'
    ],
    account_number: [
        'account number', 'accountno', 'account_no', 'account no', 'account', 'acct no', 'account id', 'account code',
        'loan number', 'loan no', 'reference number', 'reference', 'policy number',
        'customer id', 'account reference'
    ],
    connection_number: [
        'conn no', 'connno', 'connection number', 'connectionno', 'connection id'
    ],
    phone: [
        'phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'telephone number',
        'contact phone', 'contact', 'mobile no', 'mobileno', 'phone no', 'cellular', 'cell',
        'contactnumber', 'contact number'
    ],
    email: [
        'email', 'email address', 'contact email', 'client email', 'customer email', 'email account',
        'emailaccount', 'emailaddress'
    ],
    tax_id: [
        'tax id', 'tax id number', 'national id', 'national id number', 'id', 'id number',
        'id no', 'nationalid', 'passport', 'pin', 'ssn', 'business registration', 'identifier'
    ],
    outstanding_balance: [
        'balance', 'outstanding', 'outstanding balance', 'amount outstanding', 'arrears',
        'loan balance', 'principal balance', 'remaining balance', 'amount due', 'balance due',
        'current balance', 'account balance', 'balance owed', 'amount owed', 'accountbalance',
        'account balance due', 'balance outstanding', 'accountbal', 'outstandingbalance',
        'accountbalanceamount', 'account balance amount'
    ],
    due_date: [
        'due date', 'date due', 'maturity date', 'payment due', 'due', 'loan due date',
        'expected payment date', 'payment date', 'due_date', 'date_due'
    ],
    original_amount: [
        'original amount', 'amount', 'principal amount', 'loan amount', 'invoice amount',
        'principal', 'original balance', 'total amount', 'face value', 'accountbalance',
        'total balance', 'amount due', 'account balance'
    ],
    currency: [
        'currency', 'currency code', 'ccy', 'amount currency', 'currency type', 'currencycode'
    ],
    status: [
        'status', 'relationship status', 'loan status', 'payment status',
        'account state', 'relationship state'
    ],
    relationship_type: [
        'relationship type', 'debt type', 'obligation type', 'loan type', 'account type',
        'instrument type', 'product type', 'financial obligation type'
    ],
    meter_number: [
        'meterno', 'meter no', 'meter number', 'meter', 'meterid'
    ],
    property_reference: [
        'plotno', 'plot no', 'plot', 'house no', 'houseno', 'property reference', 'property',
        'propertyref', 'estate', 'site', 'location'
    ],
    zone: [
        'zonename', 'zone name', 'zone', 'area', 'locality'
    ],
    route: [
        'routenr', 'route nr', 'route number', 'route', 'routecode'
    ],
    customer_category: [
        'tariffcateg', 'tariff categ', 'tariff category', 'customer category', 'category', 'account category'
    ],
    account_status: [
        'accountstatus', 'account status', 'connection status', 'account status category'
    ],
    payment_amount: [
        'amount paid', 'payment amount', 'paid amount', 'amountpaid', 'paidamount', 'payment', 'amount received',
        'receipt amount'
    ],
    payment_method: [
        'payment method', 'method', 'paymentmethod', 'mode of payment', 'channel'
    ],
    payment_reference: [
        'reference no', 'receipt no', 'receipt number', 'transaction id', 'transaction reference', 'reference number'
    ],
    comm_type: [
        'comm type', 'communication type', 'interaction type', 'contact type', 'contact method', 'comm channel'
    ],
    notes: [
        'notes', 'note', 'comment', 'comments', 'remarks', 'interaction notes', 'call notes'
    ],
    outcome: [
        'outcome', 'result', 'call outcome', 'interaction outcome'
    ],
    next_action_date: [
        'next action date', 'next follow up', 'follow up date', 'next contact date', 'followup date'
    ],
    promised_amount: [
        'promised amount', 'ptp amount', 'promise amount', 'amount promised'
    ],
    promised_date: [
        'promised date', 'ptp date', 'promise date', 'date promised'
    ],
    ptp_status: [
        'ptp status', 'promise status'
    ],
};
// === Utility Functions ===
export const text = (value) => String(value ?? '').trim();
export const number = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '-' || raw === '—')
        return 0;
    const match = raw.replace(/[()]/g, '').match(/[-+]?\d[\d,]*(?:\.\d+)?/);
    if (!match)
        return 0;
    const cleaned = match[0].replace(/,/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? (raw.includes('(') && raw.includes(')') ? -Math.abs(parsed) : parsed) : 0;
};
export const normalizeKey = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const findValue = (row, aliases) => {
    const normalizedAliases = aliases.map(normalizeKey);
    for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined || text(value) === '')
            continue;
        const normalizedKey = normalizeKey(key);
        const matches = normalizedAliases.some((alias) => normalizedKey === alias ||
            normalizedKey.includes(alias) ||
            alias.includes(normalizedKey));
        if (matches)
            return { value, sourceColumn: key };
    }
    return null;
};
const findAliasField = (header) => {
    const normalizedHeader = normalizeKey(header.replace(/\s*\(\d+\)\s*$/, ''));
    let best = null;
    for (const [field, aliases] of Object.entries(fieldAliases)) {
        for (const alias of aliases) {
            const normalizedAlias = normalizeKey(alias);
            if (normalizedHeader === normalizedAlias) {
                const confidence = 99;
                if (!best || confidence > best.confidence)
                    best = { field, confidence };
                continue;
            }
            if (normalizedHeader.includes(normalizedAlias) || normalizedAlias.includes(normalizedHeader)) {
                const confidence = 90;
                if (!best || confidence > best.confidence)
                    best = { field, confidence };
            }
        }
    }
    return best;
};
export const classifySheet = (headers, sheetName = '') => {
    const nameKey = normalizeKey(sheetName);
    const joined = headers.map((h) => normalizeKey(h)).join(' ');
    // The sheet's own name is a strong, unambiguous signal and is checked first so that e.g. a
    // "Communications" tab isn't misclassified as an account sheet just because it has an
    // Account Number column used for linking.
    if (nameKey.includes('promise') || nameKey.includes('ptp'))
        return { type: 'PROMISE_TO_PAY', confidence: 95 };
    if (nameKey.includes('payment') || nameKey.includes('transaction'))
        return { type: 'PAYMENTS', confidence: 93 };
    if (nameKey.includes('communication') || nameKey.includes('contact') || nameKey.includes('interaction')) {
        return { type: 'COMMUNICATIONS', confidence: 93 };
    }
    if (nameKey.includes('property') || nameKey.includes('properties') || nameKey.includes('plot') || nameKey.includes('estate')) {
        return { type: 'PROPERTIES', confidence: 90 };
    }
    if (nameKey.includes('customer') || nameKey.includes('client') || nameKey.includes('borrower') || nameKey.includes('debtor')) {
        return { type: 'CUSTOMERS', confidence: 93 };
    }
    if (joined.includes('promise') || joined.includes('ptp')) {
        return { type: 'PROMISE_TO_PAY', confidence: 92 };
    }
    if ((joined.includes('payment') || joined.includes('transaction') || joined.includes('paid')) &&
        !joined.includes('balance')) {
        return { type: 'PAYMENTS', confidence: 90 };
    }
    if (joined.includes('loan') ||
        joined.includes('obligation') ||
        joined.includes('outstanding') ||
        joined.includes('balance') ||
        joined.includes('amount')) {
        return { type: 'OBLIGATIONS', confidence: 92 };
    }
    if ((joined.includes('plot') || joined.includes('property') || joined.includes('estate') || joined.includes('unit')) &&
        !joined.includes('customer')) {
        return { type: 'PROPERTIES', confidence: 85 };
    }
    if (joined.includes('customer') ||
        joined.includes('client') ||
        joined.includes('debtor') ||
        joined.includes('borrower')) {
        return { type: 'CUSTOMERS', confidence: 95 };
    }
    if (joined.includes('contact') ||
        joined.includes('interaction') ||
        joined.includes('note') ||
        joined.includes('communication')) {
        return { type: 'COMMUNICATIONS', confidence: 88 };
    }
    if (joined.includes('account') || joined.includes('conn')) {
        return { type: 'ACCOUNTS', confidence: 80 };
    }
    return { type: 'UNKNOWN', confidence: 10 };
};
// === Normalization Functions ===
export const normalizeName = (name) => {
    return text(name)
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .replace(/\s+/g, ' ');
};
export const normalizePhone = (phone) => {
    let digits = text(phone).replace(/\D/g, '');
    if (digits.length < 7)
        return '';
    // Treat common Kenyan local forms as the same E.164 number, without guessing
    // country codes for other numbers.
    if (/^0(?:7|1)\d{8}$/.test(digits))
        digits = `254${digits.slice(1)}`;
    else if (/^(?:7|1)\d{8}$/.test(digits))
        digits = `254${digits}`;
    else if (digits.startsWith('00'))
        digits = digits.slice(2);
    return `+${digits}`;
};
export const normalizeEmail = (email) => {
    const normalized = text(email).toLowerCase().replace(/\s+/g, '');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
};
export const normalizeDate = (dateStr) => {
    if (!dateStr)
        return undefined;
    const source = text(dateStr);
    if (/^\d{5}(?:\.\d+)?$/.test(source)) {
        const date = new Date(Date.UTC(1899, 11, 30) + Number(source) * 86400000);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
    }
    const slash = source.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (slash) {
        const a = Number(slash[1]);
        const b = Number(slash[2]);
        if (a <= 12 && b <= 12)
            return undefined;
        const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
        const month = a > 12 ? b : a;
        const day = a > 12 ? a : b;
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day)
            return date.toISOString().slice(0, 10);
    }
    try {
        const date = new Date(source);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString().split('T')[0];
    }
    catch {
        return undefined;
    }
};
// Only returns a currency when the source data actually indicates one (explicit column or
// a currency prefix/suffix embedded in an amount string). Never invents a currency.
export const detectCurrency = (...sources) => {
    const combined = sources.join(' ').toUpperCase();
    if (/\bKSH|\bKES|\bKSHS\b/.test(combined))
        return 'KES';
    if (/\bUSD|\$/.test(combined))
        return 'USD';
    if (/\bEUR|€/.test(combined))
        return 'EUR';
    if (/\bGBP|£/.test(combined))
        return 'GBP';
    if (/\bUGX\b/.test(combined))
        return 'UGX';
    if (/\bTZS\b/.test(combined))
        return 'TZS';
    const explicit = combined.trim();
    if (/^[A-Z]{3}$/.test(explicit))
        return explicit;
    return undefined;
};
// === Group Suggestions (union-find over sheets sharing identifying fields) ===
export function buildGroupSuggestions(sheetMetadata) {
    if (sheetMetadata.length === 0)
        return [];
    const identifyingFields = new Set([
        'account_number', 'phone', 'email', 'tax_id', 'property_reference', 'meter_number',
    ]);
    const profiles = sheetMetadata.map((sheet) => {
        const canonicalFields = new Set();
        for (const header of sheet.headers) {
            const match = findAliasField(header);
            if (match && identifyingFields.has(match.field))
                canonicalFields.add(match.field);
        }
        return { name: sheet.name, canonicalFields };
    });
    const parent = new Map();
    const find = (x) => {
        if (!parent.has(x))
            parent.set(x, x);
        let root = x;
        while (parent.get(root) !== root)
            root = parent.get(root);
        parent.set(x, root);
        return root;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(ra, rb);
    };
    const sharedFieldByPair = new Map();
    for (let i = 0; i < profiles.length; i++) {
        find(profiles[i].name);
        for (let j = i + 1; j < profiles.length; j++) {
            const shared = [...profiles[i].canonicalFields].filter((field) => profiles[j].canonicalFields.has(field));
            if (shared.length > 0) {
                union(profiles[i].name, profiles[j].name);
                sharedFieldByPair.set(`${profiles[i].name}|${profiles[j].name}`, shared[0]);
            }
        }
    }
    const clusters = new Map();
    for (const profile of profiles) {
        const root = find(profile.name);
        if (!clusters.has(root))
            clusters.set(root, []);
        clusters.get(root).push(profile.name);
    }
    const suggestions = [];
    let groupIndex = 1;
    for (const sheets of clusters.values()) {
        const sorted = sheets.sort();
        let commonField = 'name';
        for (const key of sharedFieldByPair.keys()) {
            const [a, b] = key.split('|');
            if (sorted.includes(a) && sorted.includes(b)) {
                commonField = sharedFieldByPair.get(key);
                break;
            }
        }
        suggestions.push({
            name: sorted.length > 1 ? `Group ${groupIndex}` : sorted[0],
            confidence: sorted.length > 1 ? 88 : 60,
            commonField,
            sheets: sorted,
            reason: sorted.length > 1
                ? `Sheets share the ${commonField} identifier, suggesting the same source/portfolio.`
                : 'No shared identifier with other sheets; suggested as its own group.',
        });
        groupIndex++;
    }
    return suggestions.sort((a, b) => b.sheets.length - a.sheets.length);
}
// === Sheet Parsing ===
function emptyParsedSheet(issue) {
    return {
        entities: [],
        relationships: [],
        payments: [],
        properties: [],
        communications: [],
        promises: [],
        validationResult: {
            totalRows: 0,
            validRows: 0,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: 0,
            issues: [issue],
            errors: [],
            skippedRows: [],
        },
        fieldMappings: [],
    };
}
const CUSTOMER_CONSUMED_FIELDS = new Set(['customer_name', 'entity_type', 'phone', 'email', 'account_number', 'tax_id']);
const OBLIGATION_CONSUMED_FIELDS = new Set([
    'customer_name', 'outstanding_balance', 'account_number', 'original_amount', 'currency',
    'status', 'relationship_type', 'due_date', 'entity_type', 'phone', 'email',
]);
const PAYMENT_CONSUMED_FIELDS = new Set(['payment_amount', 'account_number', 'customer_name', 'due_date', 'payment_method', 'payment_reference']);
function buildFieldMappings(headers) {
    return headers.map((header) => {
        const mapped = findAliasField(header);
        return mapped
            ? { sourceColumn: header, canonicalField: mapped.field, status: 'MATCHED', confidence: mapped.confidence }
            : { sourceColumn: header, canonicalField: 'extra_data', status: 'UNKNOWN', confidence: 0 };
    });
}
function collectExtra(row, consumedFields) {
    const extra = {};
    for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined)
            continue;
        const str = text(value);
        if (str !== '') {
            extra[key] = value;
        }
    }
    return extra;
}
export function parseCustomerSheet(rows, sourceSheet, firstDataRow = 2, sourceRowNumbers = []) {
    const entities = [];
    const issues = [];
    const skippedRows = [];
    let errorCount = 0;
    if (rows.length === 0)
        return emptyParsedSheet('No data rows found in sheet');
    const headers = Object.keys(rows[0] ?? {});
    const fieldMappings = buildFieldMappings(headers);
    for (const [rowIndex, row] of rows.entries()) {
        try {
            const nameMatch = findValue(row, fieldAliases.customer_name);
            if (!nameMatch || !text(nameMatch.value)) {
                errorCount++;
                issues.push('Missing customer_name');
                skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason: 'Missing customer_name', rawData: row });
                continue;
            }
            const customerName = normalizeName(text(nameMatch.value));
            const entityTypeMatch = findValue(row, fieldAliases.entity_type);
            const rawType = text(entityTypeMatch?.value || 'BUSINESS').toUpperCase();
            const entityType = ['INDIVIDUAL', 'PERSON', 'PRIVATE INDIVIDUAL'].includes(rawType)
                ? 'INDIVIDUAL'
                : 'BUSINESS';
            const phoneMatch = findValue(row, fieldAliases.phone);
            const phone = phoneMatch ? normalizePhone(text(phoneMatch.value)) : undefined;
            const emailMatch = findValue(row, fieldAliases.email);
            const email = emailMatch ? normalizeEmail(text(emailMatch.value)) : undefined;
            const accountMatch = findValue(row, fieldAliases.account_number);
            const accountNumber = accountMatch ? text(accountMatch.value) : undefined;
            const taxMatch = findValue(row, fieldAliases.tax_id);
            const taxId = taxMatch ? text(taxMatch.value) : undefined;
            entities.push({
                customer_name: customerName,
                entity_type: entityType,
                phone: phone || undefined,
                email,
                account_number: accountNumber,
                tax_id: taxId,
                extra_data: collectExtra(row, CUSTOMER_CONSUMED_FIELDS),
                sourceReferences: sourceSheet ? [{ sheetName: sourceSheet, rowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex }] : undefined,
            });
        }
        catch (error) {
            errorCount++;
            const reason = `Row error: ${error instanceof Error ? error.message : 'Unknown'}`;
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
        }
    }
    return {
        entities,
        relationships: [],
        payments: [],
        properties: [],
        communications: [],
        promises: [],
        validationResult: {
            totalRows: rows.length,
            validRows: entities.length,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: errorCount,
            issues: issues.slice(0, 20),
            errors: [],
            skippedRows,
        },
        fieldMappings,
    };
}
export function parseObligationsSheet(rows, sourceSheet, firstDataRow = 2, sourceRowNumbers = []) {
    const entities = [];
    const relationships = [];
    const issues = [];
    const skippedRows = [];
    let errorCount = 0;
    if (rows.length === 0)
        return emptyParsedSheet('No data rows found in sheet');
    const headers = Object.keys(rows[0] ?? {});
    const fieldMappings = buildFieldMappings(headers);
    for (const [rowIndex, row] of rows.entries()) {
        try {
            const nameMatch = findValue(row, fieldAliases.customer_name);
            if (!nameMatch || !text(nameMatch.value)) {
                errorCount++;
                issues.push('Missing customer_name');
                skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason: 'Missing customer_name', rawData: row });
                continue;
            }
            const customerName = normalizeName(text(nameMatch.value));
            const outstandingMatch = findValue(row, fieldAliases.outstanding_balance);
            const outstandingRaw = outstandingMatch ? text(outstandingMatch.value) : '';
            const outstanding = outstandingMatch ? number(outstandingMatch.value) : 0;
            // Credits and overpayments are legitimate negative balances; preserve their sign.
            const normalizedOutstanding = Number.isFinite(outstanding) ? outstanding : 0;
            const accountMatch = findValue(row, fieldAliases.account_number);
            const accountNumber = accountMatch ? text(accountMatch.value) : undefined;
            const originalMatch = findValue(row, fieldAliases.original_amount);
            const originalRaw = originalMatch ? text(originalMatch.value) : '';
            const originalValue = originalMatch ? number(originalMatch.value) : normalizedOutstanding;
            const original = Number.isFinite(originalValue) ? originalValue : normalizedOutstanding;
            const currencyMatch = findValue(row, fieldAliases.currency);
            const currency = detectCurrency(currencyMatch ? text(currencyMatch.value) : '', outstandingRaw, originalRaw);
            const statusMatch = findValue(row, fieldAliases.status);
            const rawStatus = statusMatch ? text(statusMatch.value).toUpperCase().replace(/\s+/g, '_') : 'OPEN';
            const status = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'CLOSED'].includes(rawStatus)
                ? rawStatus
                : 'OPEN';
            // Only claim a specific relationship type (INVOICE/LOAN/TRADE_CREDIT) when the source
            // explicitly says so; otherwise use the neutral ACCOUNT type.
            const relTypeMatch = findValue(row, fieldAliases.relationship_type);
            const rawRelType = relTypeMatch ? text(relTypeMatch.value).toUpperCase() : '';
            const explicitRelTypes = ['INVOICE', 'LOAN', 'TRADE_CREDIT'];
            const relType = explicitRelTypes.includes(rawRelType)
                ? rawRelType
                : 'ACCOUNT';
            const dueMatch = findValue(row, fieldAliases.due_date);
            const dueDate = dueMatch ? normalizeDate(text(dueMatch.value)) : undefined;
            const entityTypeMatch = findValue(row, fieldAliases.entity_type);
            const rawType = text(entityTypeMatch?.value || 'INDIVIDUAL').toUpperCase();
            const entityType = ['BUSINESS', 'COMPANY', 'CORPORATE'].includes(rawType) ? 'BUSINESS' : 'INDIVIDUAL';
            const phoneMatch = findValue(row, fieldAliases.phone);
            const phone = phoneMatch ? normalizePhone(text(phoneMatch.value)) : undefined;
            const emailMatch = findValue(row, fieldAliases.email);
            const email = emailMatch ? normalizeEmail(text(emailMatch.value)) : undefined;
            const existingEntity = entities.find((e) => e.customer_name === customerName);
            if (!existingEntity) {
                entities.push({
                    customer_name: customerName,
                    entity_type: entityType,
                    phone: phone || undefined,
                    email,
                    account_number: accountNumber,
                    extra_data: collectExtra(row),
                    sourceReferences: sourceSheet ? [{ sheetName: sourceSheet, rowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex }] : undefined,
                });
            }
            else {
                existingEntity.extra_data = { ...collectExtra(row), ...existingEntity.extra_data };
                if (sourceSheet)
                    existingEntity.sourceReferences = [...(existingEntity.sourceReferences ?? []), { sheetName: sourceSheet, rowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex }];
            }
            relationships.push({
                customer_name: customerName,
                account_number: accountNumber,
                relationship_type: relType,
                original_amount: original,
                outstanding_amount: normalizedOutstanding,
                currency,
                status,
                due_date: dueDate,
                extra_data: collectExtra(row, OBLIGATION_CONSUMED_FIELDS),
            });
        }
        catch (error) {
            errorCount++;
            const reason = `Row error: ${error instanceof Error ? error.message : 'Unknown'}`;
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
        }
    }
    return {
        entities,
        relationships,
        payments: [],
        properties: [],
        communications: [],
        promises: [],
        validationResult: {
            totalRows: rows.length,
            validRows: relationships.length,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: errorCount,
            issues: issues.slice(0, 20),
            errors: [],
            skippedRows,
        },
        fieldMappings,
    };
}
export function parsePaymentsSheet(rows, sourceSheet, firstDataRow = 2, sourceRowNumbers = []) {
    const payments = [];
    const issues = [];
    const skippedRows = [];
    let errorCount = 0;
    if (rows.length === 0)
        return emptyParsedSheet('No data rows found in sheet');
    const headers = Object.keys(rows[0] ?? {});
    const fieldMappings = buildFieldMappings(headers);
    for (const [rowIndex, row] of rows.entries()) {
        try {
            const amountMatch = findValue(row, fieldAliases.payment_amount);
            const amount = amountMatch ? number(amountMatch.value) : 0;
            if (!amountMatch || amount <= 0) {
                errorCount++;
                const reason = 'Missing or invalid payment amount';
                issues.push(reason);
                skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
                continue;
            }
            const accountMatch = findValue(row, fieldAliases.account_number);
            const nameMatch = findValue(row, fieldAliases.customer_name);
            if (!accountMatch && !nameMatch) {
                errorCount++;
                const reason = 'Payment row has no account number or customer name to link it to an account';
                issues.push(reason);
                skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
                continue;
            }
            const dateMatch = findValue(row, fieldAliases.due_date);
            const methodMatch = findValue(row, fieldAliases.payment_method);
            const rawMethod = methodMatch ? text(methodMatch.value).toUpperCase().replace(/\s+/g, '_') : '';
            const explicitMethods = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'WIRE'];
            const method = explicitMethods.includes(rawMethod)
                ? rawMethod
                : 'OTHER';
            const referenceMatch = findValue(row, fieldAliases.payment_reference);
            payments.push({
                account_number: accountMatch ? text(accountMatch.value) : undefined,
                customer_name: nameMatch ? normalizeName(text(nameMatch.value)) : undefined,
                amount_paid: amount,
                payment_date: dateMatch ? normalizeDate(text(dateMatch.value)) : undefined,
                payment_method: method,
                reference_no: referenceMatch ? text(referenceMatch.value) : undefined,
                extra_data: collectExtra(row, PAYMENT_CONSUMED_FIELDS),
            });
        }
        catch (error) {
            errorCount++;
            const reason = `Row error: ${error instanceof Error ? error.message : 'Unknown'}`;
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
        }
    }
    return {
        entities: [],
        relationships: [],
        payments,
        properties: [],
        communications: [],
        promises: [],
        validationResult: {
            totalRows: rows.length,
            validRows: payments.length,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: errorCount,
            issues: issues.slice(0, 20),
            errors: [],
            skippedRows,
        },
        fieldMappings,
    };
}
function parseUnknownSheet(rows, sheetName) {
    const fieldMappings = buildFieldMappings(Object.keys(rows[0] ?? {}));
    const entities = rows.map((row, index) => {
        const firstValue = Object.values(row).map(text).find(Boolean);
        return {
            customer_name: normalizeName(firstValue || `${sheetName} record ${index + 1}`),
            entity_type: 'BUSINESS',
            extra_data: { source_sheet: sheetName, source: row },
        };
    });
    return {
        entities,
        relationships: [],
        payments: [],
        properties: [],
        communications: [],
        promises: [],
        validationResult: {
            totalRows: rows.length,
            validRows: rows.length,
            reviewRows: rows.length,
            duplicateRows: 0,
            errorRows: 0,
            issues: [`${sheetName}: no canonical customer or obligation mapping was found; source values will be preserved as extra data.`],
            errors: [],
        },
        fieldMappings,
    };
}
const PROPERTY_CONSUMED_FIELDS = new Set(['account_number', 'property_reference']);
// Properties have no dedicated table; rows are matched to an existing account by account_number
// at commit time and merged into that account's extra_data instead of becoming a new record type.
export function parsePropertiesSheet(rows, sourceSheet, firstDataRow = 2, sourceRowNumbers = []) {
    const properties = [];
    const issues = [];
    const skippedRows = [];
    let errorCount = 0;
    if (rows.length === 0)
        return emptyParsedSheet('No data rows found in sheet');
    const headers = Object.keys(rows[0] ?? {});
    const fieldMappings = buildFieldMappings(headers);
    for (const [rowIndex, row] of rows.entries()) {
        const accountMatch = findValue(row, fieldAliases.account_number);
        const propertyMatch = findValue(row, fieldAliases.property_reference);
        if (!accountMatch && !propertyMatch) {
            errorCount++;
            const reason = 'Property row has no account number or property reference to link it to an account';
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
            continue;
        }
        properties.push({
            account_number: accountMatch ? text(accountMatch.value) : undefined,
            property_reference: propertyMatch ? text(propertyMatch.value) : undefined,
            extra_data: collectExtra(row, PROPERTY_CONSUMED_FIELDS),
        });
    }
    return {
        entities: [],
        relationships: [],
        payments: [],
        properties,
        communications: [],
        promises: [],
        validationResult: {
            totalRows: rows.length,
            validRows: properties.length,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: errorCount,
            issues: issues.slice(0, 20),
            errors: [],
            skippedRows,
        },
        fieldMappings,
    };
}
const COMM_TYPE_ALIASES = {
    CALL: ['call', 'phone', 'phone call', 'telephone call'],
    SMS: ['sms', 'text', 'text message'],
    EMAIL: ['email', 'mail', 'e-mail'],
    WHATSAPP: ['whatsapp', 'wa'],
};
function detectCommType(raw) {
    const normalized = normalizeKey(raw);
    for (const [type, aliases] of Object.entries(COMM_TYPE_ALIASES)) {
        if (aliases.some((alias) => normalized === normalizeKey(alias)))
            return type;
    }
    return undefined;
}
const COMMUNICATION_CONSUMED_FIELDS = new Set(['customer_name', 'account_number', 'comm_type', 'notes', 'outcome', 'next_action_date']);
// comm_type has no neutral fallback in the schema (CALL/SMS/EMAIL/WHATSAPP only), so rows without
// an explicit, recognizable type are skipped and reported instead of guessing.
export function parseCommunicationsSheet(rows, sourceSheet, firstDataRow = 2, sourceRowNumbers = []) {
    const communications = [];
    const issues = [];
    const skippedRows = [];
    let errorCount = 0;
    if (rows.length === 0)
        return emptyParsedSheet('No data rows found in sheet');
    const headers = Object.keys(rows[0] ?? {});
    const fieldMappings = buildFieldMappings(headers);
    for (const [rowIndex, row] of rows.entries()) {
        const nameMatch = findValue(row, fieldAliases.customer_name);
        const accountMatch = findValue(row, fieldAliases.account_number);
        if (!nameMatch && !accountMatch) {
            errorCount++;
            const reason = 'Communication row has no customer name or account number to link it to an entity';
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
            continue;
        }
        const typeMatch = findValue(row, fieldAliases.comm_type);
        const commType = typeMatch ? detectCommType(text(typeMatch.value)) : undefined;
        if (!commType) {
            errorCount++;
            const reason = 'Communication row is missing a recognizable type (call, sms, email, or whatsapp)';
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
            continue;
        }
        const notesMatch = findValue(row, fieldAliases.notes);
        const outcomeMatch = findValue(row, fieldAliases.outcome);
        const nextActionMatch = findValue(row, fieldAliases.next_action_date);
        communications.push({
            customer_name: nameMatch ? normalizeName(text(nameMatch.value)) : undefined,
            account_number: accountMatch ? text(accountMatch.value) : undefined,
            comm_type: commType,
            notes: notesMatch ? text(notesMatch.value) : undefined,
            outcome: outcomeMatch ? text(outcomeMatch.value) : undefined,
            next_action_date: nextActionMatch ? normalizeDate(text(nextActionMatch.value)) : undefined,
            extra_data: collectExtra(row, COMMUNICATION_CONSUMED_FIELDS),
        });
    }
    return {
        entities: [],
        relationships: [],
        payments: [],
        properties: [],
        communications,
        promises: [],
        validationResult: {
            totalRows: rows.length,
            validRows: communications.length,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: errorCount,
            issues: issues.slice(0, 20),
            errors: [],
            skippedRows,
        },
        fieldMappings,
    };
}
const PROMISE_CONSUMED_FIELDS = new Set(['customer_name', 'account_number', 'promised_amount', 'promised_date', 'ptp_status']);
export function parsePromiseSheet(rows, sourceSheet, firstDataRow = 2, sourceRowNumbers = []) {
    const promises = [];
    const issues = [];
    const skippedRows = [];
    let errorCount = 0;
    if (rows.length === 0)
        return emptyParsedSheet('No data rows found in sheet');
    const headers = Object.keys(rows[0] ?? {});
    const fieldMappings = buildFieldMappings(headers);
    for (const [rowIndex, row] of rows.entries()) {
        const nameMatch = findValue(row, fieldAliases.customer_name);
        const accountMatch = findValue(row, fieldAliases.account_number);
        if (!nameMatch && !accountMatch) {
            errorCount++;
            const reason = 'Promise row has no customer name or account number to link it to an entity';
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
            continue;
        }
        const amountMatch = findValue(row, fieldAliases.promised_amount);
        const amount = amountMatch ? number(amountMatch.value) : 0;
        const dateMatch = findValue(row, fieldAliases.promised_date);
        const promisedDate = dateMatch ? normalizeDate(text(dateMatch.value)) : undefined;
        if (amount <= 0 || !promisedDate) {
            errorCount++;
            const reason = 'Promise row is missing a valid promised amount or promised date';
            issues.push(reason);
            skippedRows.push({ sourceRowNumber: sourceRowNumbers[rowIndex] ?? firstDataRow + rowIndex, reason, rawData: row });
            continue;
        }
        const statusMatch = findValue(row, fieldAliases.ptp_status);
        const rawStatus = statusMatch ? text(statusMatch.value).toUpperCase() : 'PENDING';
        const status = ['PENDING', 'FULFILLED', 'BROKEN'].includes(rawStatus)
            ? rawStatus
            : 'PENDING';
        promises.push({
            customer_name: nameMatch ? normalizeName(text(nameMatch.value)) : undefined,
            account_number: accountMatch ? text(accountMatch.value) : undefined,
            promised_amount: amount,
            promised_date: promisedDate,
            status,
            extra_data: collectExtra(row, PROMISE_CONSUMED_FIELDS),
        });
    }
    return {
        entities: [],
        relationships: [],
        payments: [],
        properties: [],
        communications: [],
        promises,
        validationResult: {
            totalRows: rows.length,
            validRows: promises.length,
            reviewRows: 0,
            duplicateRows: 0,
            errorRows: errorCount,
            issues: issues.slice(0, 20),
            errors: [],
            skippedRows,
        },
        fieldMappings,
    };
}
export function parseSheetByType(type, rows, sheetName, firstDataRow = 2, sourceRowNumbers = []) {
    switch (type) {
        case 'CUSTOMERS':
            return parseCustomerSheet(rows, sheetName, firstDataRow, sourceRowNumbers);
        case 'OBLIGATIONS':
        case 'ACCOUNTS':
            return parseObligationsSheet(rows, sheetName, firstDataRow, sourceRowNumbers);
        case 'PAYMENTS':
            return parsePaymentsSheet(rows, sheetName, firstDataRow, sourceRowNumbers);
        case 'PROPERTIES':
            return parsePropertiesSheet(rows, sheetName, firstDataRow, sourceRowNumbers);
        case 'COMMUNICATIONS':
            return parseCommunicationsSheet(rows, sheetName, firstDataRow, sourceRowNumbers);
        case 'PROMISE_TO_PAY':
            return parsePromiseSheet(rows, sheetName, firstDataRow, sourceRowNumbers);
        default:
            return parseUnknownSheet(rows, sheetName);
    }
}
// === Cross-sheet relationship discovery ===
//
// Clusters entity rows across every sheet in the workbook using exact shared identifiers
// (account number, phone, email, tax id). Rows that only share a normalized name, without a
// shared identifier, are reported as a "possible match" instead of being merged automatically.
function keysFor(entity) {
    const keys = [];
    if (entity.account_number)
        keys.push({ key: `account:${normalizeKey(entity.account_number)}`, type: 'ACCOUNT_NUMBER' });
    if (entity.tax_id)
        keys.push({ key: `tax:${normalizeKey(entity.tax_id)}`, type: 'TAX_ID' });
    return keys;
}
const MATCH_CONFIDENCE = {
    strongIdentifier: 100,
    contactIdentifier: 75,
    exactName: 65,
    similarName: 55,
    conflictingIdentifier: 50,
};
function conflictingIdentifiers(a, b) {
    const conflicts = [];
    if (a.tax_id && b.tax_id && normalizeKey(a.tax_id) !== normalizeKey(b.tax_id))
        conflicts.push('Tax identifiers differ.');
    if (a.entity_type !== b.entity_type)
        conflicts.push('Entity types differ.');
    return conflicts;
}
export function clusterEntities(allEntities, sourceWorkbook) {
    const parent = allEntities.map((_, index) => index);
    const find = (x) => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const members = () => {
        const clusters = new Map();
        allEntities.forEach((_, index) => {
            const root = find(index);
            clusters.set(root, [...(clusters.get(root) ?? []), index]);
        });
        return clusters;
    };
    const canUnion = (a, b) => {
        const left = members().get(find(a)) ?? [];
        const right = members().get(find(b)) ?? [];
        return left.every((leftIndex) => right.every((rightIndex) => conflictingIdentifiers(allEntities[leftIndex], allEntities[rightIndex]).length === 0));
    };
    const keyIndexes = new Map();
    allEntities.forEach((entity, index) => {
        for (const identifier of keysFor(entity)) {
            keyIndexes.set(identifier.key, [...(keyIndexes.get(identifier.key) ?? []), { index, type: identifier.type }]);
        }
    });
    const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
    const deterministicEvidence = new Map();
    const conflictPairs = new Map();
    for (const [identifier, entries] of keyIndexes) {
        for (let left = 0; left < entries.length; left++) {
            for (let right = left + 1; right < entries.length; right++) {
                const a = entries[left].index;
                const b = entries[right].index;
                if (a === b)
                    continue;
                const key = pairKey(a, b);
                const conflicts = conflictingIdentifiers(allEntities[a], allEntities[b]);
                if (conflicts.length || !canUnion(a, b)) {
                    const pair = conflictPairs.get(key) ?? { a, b, evidence: new Set(), conflicts: new Set() };
                    pair.evidence.add(`Shared ${entries[left].type.toLowerCase().replace('_', ' ')} identifier.`);
                    conflicts.forEach((conflict) => pair.conflicts.add(conflict));
                    conflictPairs.set(key, pair);
                    continue;
                }
                parent[find(a)] = find(b);
                const pair = deterministicEvidence.get(key) ?? { a, b, evidence: new Set() };
                pair.evidence.add(`Exact ${entries[left].type.toLowerCase().replace('_', ' ')} match.`);
                deterministicEvidence.set(key, pair);
            }
        }
    }
    const displayCandidate = (entity, index) => {
        const reference = entity.sourceReferences?.[0];
        return reference
            ? `${entity.customer_name} (${reference.sheetName}, row ${reference.rowNumber})`
            : `${entity.customer_name} (row ${index + 1})`;
    };
    const buildMatch = (a, b, matchType, confidence, level, supportingEvidence, conflictingEvidence = []) => ({
        candidateA: displayCandidate(allEntities[a], a),
        candidateB: displayCandidate(allEntities[b], b),
        confidence,
        level,
        reason: conflictingEvidence.length
            ? 'A shared identifier is contradicted by other identifying evidence; review without merging.'
            : `Possible ${matchType.toLowerCase().replace('_', ' ')} match; review before merging.`,
        matchType,
        supportingEvidence,
        conflictingEvidence,
        sourceWorkbook,
        sourceReferencesA: allEntities[a].sourceReferences ?? [],
        sourceReferencesB: allEntities[b].sourceReferences ?? [],
        recommendedAction: 'REVIEW',
    });
    const deterministicMatches = [...deterministicEvidence.values()].map(({ a, b, evidence }) => ({
        ...buildMatch(a, b, evidence.size > 1 && evidence.has('Exact tax id match.') ? 'TAX_ID' : 'ACCOUNT_NUMBER', MATCH_CONFIDENCE.strongIdentifier, 'HIGH', [...evidence]),
        recommendedAction: 'ACCEPT',
        reason: 'Exact account or tax identifier match with no conflicting tax identifier or entity type.',
    }));
    const possibleMatches = new Map();
    const addReviewMatch = (a, b, match) => {
        const key = pairKey(a, b);
        const existing = possibleMatches.get(key);
        if (!existing) {
            possibleMatches.set(key, match);
            return;
        }
        existing.supportingEvidence = [...new Set([...existing.supportingEvidence, ...match.supportingEvidence])];
        existing.conflictingEvidence = [...new Set([...existing.conflictingEvidence, ...match.conflictingEvidence])];
        if (match.matchType === 'IDENTIFIER_CONFLICT') {
            existing.matchType = 'IDENTIFIER_CONFLICT';
            existing.confidence = Math.max(existing.confidence, match.confidence);
            existing.level = existing.confidence >= 70 ? 'MEDIUM' : 'LOW';
            existing.reason = match.reason;
        }
        else if (match.confidence > existing.confidence && existing.matchType !== 'IDENTIFIER_CONFLICT') {
            existing.confidence = match.confidence;
            existing.level = match.level;
            existing.matchType = match.matchType;
            existing.reason = match.reason;
        }
        if (existing.conflictingEvidence.length)
            existing.reason = 'A shared identifier is contradicted by other identifying evidence; review without merging.';
    };
    for (const { a, b, evidence, conflicts } of conflictPairs.values()) {
        addReviewMatch(a, b, buildMatch(a, b, 'IDENTIFIER_CONFLICT', MATCH_CONFIDENCE.conflictingIdentifier, 'MEDIUM', [...evidence], [...conflicts]));
    }
    const contactIndexes = new Map();
    allEntities.forEach((entity, index) => {
        if (entity.phone)
            contactIndexes.set(`phone:${normalizeKey(entity.phone)}`, [...(contactIndexes.get(`phone:${normalizeKey(entity.phone)}`) ?? []), { index, type: 'PHONE' }]);
        if (entity.email)
            contactIndexes.set(`email:${normalizeKey(entity.email)}`, [...(contactIndexes.get(`email:${normalizeKey(entity.email)}`) ?? []), { index, type: 'EMAIL' }]);
    });
    for (const entries of contactIndexes.values()) {
        for (let left = 0; left < entries.length; left++) {
            for (let right = left + 1; right < entries.length; right++) {
                const a = entries[left].index;
                const b = entries[right].index;
                if (find(a) === find(b))
                    continue;
                const conflicts = conflictingIdentifiers(allEntities[a], allEntities[b]);
                addReviewMatch(a, b, buildMatch(a, b, entries[left].type, MATCH_CONFIDENCE.contactIdentifier, 'MEDIUM', [`Exact ${entries[left].type.toLowerCase()} match; contact details can be shared.`], conflicts));
            }
        }
    }
    for (let i = 0; i < allEntities.length; i++) {
        for (let j = i + 1; j < allEntities.length; j++) {
            if (find(i) === find(j))
                continue;
            const first = normalizeKey(allEntities[i].customer_name);
            const second = normalizeKey(allEntities[j].customer_name);
            const conflicts = conflictingIdentifiers(allEntities[i], allEntities[j]);
            if (first && first === second) {
                addReviewMatch(i, j, buildMatch(i, j, 'EXACT_NAME', MATCH_CONFIDENCE.exactName, 'MEDIUM', ['Exact normalized name.'], conflicts));
                continue;
            }
            const a = allEntities[i].customer_name.toLowerCase().split(/\s+/).filter(Boolean);
            const b = allEntities[j].customer_name.toLowerCase().split(/\s+/).filter(Boolean);
            if (a.length < 2 || b.length < 2 || a.join('') === b.join(''))
                continue;
            if (a[a.length - 1] === b[b.length - 1] && a[0][0] === b[0][0]) {
                addReviewMatch(i, j, buildMatch(i, j, 'SIMILAR_NAME', MATCH_CONFIDENCE.similarName, 'LOW', ['Same surname and first-name initial.'], conflicts));
            }
        }
    }
    const clusterOf = allEntities.map((_, index) => find(index));
    const remap = new Map();
    const compactClusterOf = clusterOf.map((cluster) => {
        if (!remap.has(cluster))
            remap.set(cluster, remap.size);
        return remap.get(cluster);
    });
    return { clusterOf: compactClusterOf, clusterCount: remap.size, possibleMatches: [...possibleMatches.values()], deterministicMatches };
}
// === Full workbook parse (single source of truth for both preview and commit) ===
/**
 * Converts an unstructured worksheet grid into records. Header selection is intentionally
 * evidence based: reports often start with a title, generated date, blank rows or notes.
 * This is kept independent of XLSX so CSV and workbook readers share the same behaviour.
 */
export function inspectSheetMatrix(name, matrix) {
    const width = matrix.reduce((largest, row) => Math.max(largest, row?.length ?? 0), 0);
    const isPopulated = (value) => text(value) !== '';
    const emptyRows = matrix.filter((row) => !row || !row.some(isPopulated)).length;
    const candidates = matrix.slice(0, Math.min(matrix.length, 30));
    let headerRow = 0;
    let bestScore = -1;
    candidates.forEach((row, index) => {
        const cells = (row ?? []).map(text).filter(Boolean);
        if (!cells.length)
            return;
        const recognized = cells.filter((cell) => Boolean(findAliasField(cell))).length;
        const labels = cells.filter((cell) => /[a-z]/i.test(cell) && !/^[-+]?\d[\d,./-]*$/.test(cell)).length;
        const following = matrix.slice(index + 1, Math.min(matrix.length, index + 6));
        const dataLikeRows = following.filter((next) => next?.filter(isPopulated).length >= Math.max(1, Math.min(2, cells.length))).length;
        // Semantic matches matter most, then a label-like row followed by tabular data.
        const score = recognized * 12 + Math.min(labels, 8) + dataLikeRows * 2 + Math.min(cells.length, 10) / 10;
        if (score > bestScore) {
            bestScore = score;
            headerRow = index;
        }
    });
    const selectedCells = (matrix[headerRow] ?? []).map(text);
    const headerLabels = selectedCells.map((value, index) => normalizeKey(value || `Column ${index + 1}`));
    const recognizedHeaders = selectedCells.filter((value) => Boolean(findAliasField(value))).length;
    const headerConfidence = selectedCells.filter(Boolean).length
        ? Math.round((recognizedHeaders / selectedCells.filter(Boolean).length) * 100)
        : 0;
    const seen = new Map();
    const duplicateColumns = [];
    const dataRowNumbers = [];
    const headers = Array.from({ length: width }, (_, column) => {
        const raw = text(matrix[headerRow]?.[column]) || `Column ${column + 1}`;
        const count = (seen.get(raw.toLowerCase()) ?? 0) + 1;
        seen.set(raw.toLowerCase(), count);
        if (count > 1)
            duplicateColumns.push(raw);
        return count === 1 ? raw : `${raw} (${count})`;
    });
    const repeatedHeaderRows = [];
    const nonRecordRows = [];
    const rows = matrix.slice(headerRow + 1)
        .flatMap((row, offset) => {
        if (!row?.some(isPopulated))
            return [];
        const rowNumber = headerRow + offset + 2;
        const populated = row.map(text).filter(Boolean);
        const normalizedRow = row.map((value) => normalizeKey(text(value)));
        const matchingHeaders = normalizedRow.filter((value, column) => value && value === headerLabels[column]).length;
        if (matchingHeaders >= Math.max(2, Math.ceil(headerLabels.filter(Boolean).length * 0.6))) {
            repeatedHeaderRows.push(rowNumber);
            nonRecordRows.push({ rowNumber, reason: 'Repeated header row' });
            return [];
        }
        const firstValue = normalizeKey(populated[0] ?? '');
        if (/^(?:grand)?totals?$/.test(firstValue) || populated.some((value) => /^(?:grand)?totals?$/.test(normalizeKey(value))) && populated.length < Math.max(3, width / 2)) {
            nonRecordRows.push({ rowNumber, reason: 'Total or subtotal row' });
            return [];
        }
        dataRowNumbers.push(rowNumber);
        return [Object.fromEntries(headers.map((header, column) => [header, row?.[column] ?? '']))];
    });
    return {
        name,
        rows,
        inspection: {
            rowCount: rows.length,
            columnCount: width,
            headerRow: headerRow + 1,
            emptyRows,
            duplicateColumns: [...new Set(duplicateColumns)],
            ignoredLeadingRows: headerRow,
            headerConfidence,
            uncertainHeader: recognizedHeaders === 0 || headerConfidence < 25,
            repeatedHeaderRows,
            nonRecordRows,
            dataRowNumbers,
        },
    };
}
export function parseWorkbookSheets(sheetRows, fileName) {
    const sheets = [];
    const sheetMetadata = [];
    let totalRows = 0;
    let validRows = 0;
    let errorRows = 0;
    for (const { name, rows, inspection } of sheetRows) {
        const populatedRows = rows.filter((row) => row && Object.values(row).some((value) => text(value).length > 0));
        if (populatedRows.length === 0)
            continue;
        const headers = Object.keys(populatedRows[0] ?? {});
        const classification = classifySheet(headers, name);
        const parsed = parseSheetByType(classification.type, populatedRows, name, (inspection?.headerRow ?? 1) + 1, inspection?.dataRowNumbers);
        if (inspection?.duplicateColumns.length) {
            parsed.validationResult.issues.unshift(`Duplicate columns preserved: ${inspection.duplicateColumns.join(', ')}`);
            parsed.validationResult.reviewRows += populatedRows.length;
        }
        if (inspection && inspection.ignoredLeadingRows > 0) {
            parsed.validationResult.issues.unshift(`Detected header on row ${inspection.headerRow}; ignored ${inspection.ignoredLeadingRows} leading row(s).`);
        }
        if (inspection?.uncertainHeader) {
            parsed.validationResult.issues.unshift(`Header row ${inspection.headerRow} is uncertain; review the detected columns before importing.`);
            parsed.validationResult.reviewRows += 1;
        }
        if (inspection?.nonRecordRows.length) {
            parsed.validationResult.issues.unshift(`Skipped ${inspection.nonRecordRows.length} non-record row(s): ${inspection.nonRecordRows.map((row) => `${row.rowNumber} (${row.reason})`).join(', ')}.`);
        }
        sheets.push({
            name,
            type: classification.type,
            confidence: classification.confidence,
            headers,
            ...parsed,
        });
        sheetMetadata.push({ name, headers });
        totalRows += parsed.validationResult.totalRows;
        validRows += parsed.validationResult.validRows;
        errorRows += parsed.validationResult.errorRows;
    }
    const allEntities = sheets.flatMap((sheet) => sheet.entities);
    const { clusterCount, possibleMatches, deterministicMatches } = clusterEntities(allEntities, fileName);
    const groupSuggestions = buildGroupSuggestions(sheetMetadata);
    return {
        fileName,
        sheets,
        groupSuggestions,
        possibleMatches,
        deterministicMatches,
        totalRows,
        validRows,
        errorRows,
        entityClusterCount: clusterCount,
    };
}
export function buildImportReviewItems(parsed, inspections) {
    const items = [];
    for (const sheet of parsed.sheets) {
        const inspection = inspections.get(sheet.name);
        if (inspection?.uncertainHeader) {
            items.push({
                id: `header:${sheet.name}`,
                type: 'UNCERTAIN_HEADER',
                sheetName: sheet.name,
                title: 'Confirm detected header row',
                detail: `Header row ${inspection.headerRow} has only ${inspection.headerConfidence}% recognized fields. Accept the sampled layout to continue.`,
            });
        }
        if (inspection?.duplicateColumns.length) {
            items.push({
                id: `duplicates:${sheet.name}`,
                type: 'DUPLICATE_COLUMNS',
                sheetName: sheet.name,
                title: 'Confirm duplicate column handling',
                detail: `Duplicate headings: ${inspection.duplicateColumns.join(', ')}. The first matching column supplies recognized fields; every original value remains in the workbook source data.`,
            });
        }
        if (sheet.validationResult.errorRows > 0) {
            const issueExamples = sheet.validationResult.issues.slice(0, 3).join('; ');
            items.push({
                id: `invalid-rows:${sheet.name}`,
                type: 'INVALID_ROWS',
                sheetName: sheet.name,
                title: `Review ${sheet.validationResult.errorRows} skipped row(s)`,
                detail: `${issueExamples || 'Rows did not meet the requirements for their detected record type.'} Keep these rows as-is in the raw import archive; they will not be converted into guessed canonical fields.`,
            });
        }
    }
    return items;
}
