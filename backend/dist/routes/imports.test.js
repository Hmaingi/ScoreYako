import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObligationsSheet, parsePropertiesSheet, parseCommunicationsSheet, parsePromiseSheet, clusterEntities, inspectSheetMatrix, buildImportReviewItems, parseWorkbookSheets, normalizeDate, normalizeEmail, normalizePhone, number, } from '../lib/importer.js';
test('inspection finds a header below title rows and preserves duplicate columns', () => {
    const inspected = inspectSheetMatrix('Accounts', [
        ['Collections report - October'],
        [],
        ['Borrower Full Name', 'Mobile No.', 'Balance', 'Balance'],
        ['JOHN KAMAU', '0712 345 678', 'KES 1,200.50', '1200.50'],
    ]);
    assert.equal(inspected.inspection.headerRow, 3);
    assert.deepEqual(inspected.inspection.duplicateColumns, ['Balance']);
    assert.equal(inspected.rows[0]['Mobile No.'], '0712 345 678');
    assert.equal(inspected.rows[0]['Balance (2)'], '1200.50');
});
test('inspection skips repeated headers and totals while retaining row provenance', () => {
    const inspected = inspectSheetMatrix('Accounts', [
        ['Customer Name', 'Account Number', 'Balance'],
        ['Acme Ltd', 'ACC-1', '100'],
        ['Customer Name', 'Account Number', 'Balance'],
        ['TOTAL', '', '100'],
        ['Beta Ltd', 'ACC-2', '-25'],
    ]);
    assert.deepEqual(inspected.rows.map((row) => row['Customer Name']), ['Acme Ltd', 'Beta Ltd']);
    assert.deepEqual(inspected.inspection.repeatedHeaderRows, [3]);
    assert.deepEqual(inspected.inspection.nonRecordRows, [
        { rowNumber: 3, reason: 'Repeated header row' },
        { rowNumber: 4, reason: 'Total or subtotal row' },
    ]);
    assert.deepEqual(inspected.inspection.dataRowNumbers, [2, 5]);
    const parsed = parseWorkbookSheets([inspected], 'messy-accounts.xlsx');
    assert.deepEqual(parsed.sheets[0].entities.map((entity) => entity.sourceReferences), [
        [{ sheetName: 'Accounts', rowNumber: 2 }],
        [{ sheetName: 'Accounts', rowNumber: 5 }],
    ]);
});
test('normalizes real-world phone, email, date and negative money forms', () => {
    assert.equal(normalizePhone('0712 345 678'), '+254712345678');
    assert.equal(normalizePhone('+254712345678'), '+254712345678');
    assert.equal(normalizeEmail(' John.Doe@Example.COM '), 'john.doe@example.com');
    assert.equal(normalizeDate('31/10/2026'), '2026-10-31');
    assert.equal(normalizeDate('03/04/2026'), undefined);
    assert.equal(number('(1,250.50)'), -1250.5);
});
test('near name matches are surfaced for review but not automatically merged', () => {
    const clustered = clusterEntities([
        { customer_name: 'John K Kamau', entity_type: 'INDIVIDUAL', extra_data: {} },
        { customer_name: 'J Kamau', entity_type: 'INDIVIDUAL', extra_data: {} },
    ]);
    assert.equal(clustered.clusterCount, 2);
    assert.equal(clustered.possibleMatches[0]?.level, 'LOW');
});
test('invalid or blank balances are normalized instead of rejected', () => {
    const parsed = parseObligationsSheet([
        {
            'Customer Name': 'Acme Ltd',
            'Balance Due': 'invalid',
            'Original Amount': '5000',
            'Currency': 'USD',
            'Due Date': '2026-10-15',
        },
        {
            'Customer Name': 'Beta Ltd',
            'Outstanding Balance': '',
            'Original Amount': '300',
            'Currency': 'USD',
        },
    ]);
    assert.equal(parsed.validationResult.errorRows, 0);
    assert.equal(parsed.relationships.length, 2);
    assert.equal(parsed.relationships[0].outstanding_amount, 0);
    assert.equal(parsed.relationships[1].outstanding_amount, 0);
});
test('negative balances are retained as credits instead of silently zeroed', () => {
    const parsed = parseObligationsSheet([{ 'Customer Name': 'Credit Customer', 'Balance Due': '(1,250.50)' }]);
    assert.equal(parsed.relationships[0].outstanding_amount, -1250.5);
});
test('vall-like real export rows parse with actual field names and currency text', () => {
    const parsed = parseObligationsSheet([
        {
            AccountNo: '02844',
            ConnNo: '07000102601',
            CustomerName: 'PAUL MUNGAI',
            MobileNo: '0720776920',
            MeterNo: 'XX-6257',
            PlotNo: 'VALLEY VIEW 2',
            ZoneName: 'MLOLONGO 1',
            RouteNR: 'W:51- R:999.0000',
            AccountStatus: 'Active',
            EmailAccount: 'alexmungala@gmail.com',
            TariffCateg: 'DOMESTIC/RESIDENTIAL',
            AccountBalance: 'KSH. 6,759,407.00',
            PIN: 'A-123',
        },
    ]);
    assert.equal(parsed.relationships.length, 1);
    assert.equal(parsed.entities[0].customer_name, 'Paul Mungai');
    assert.equal(parsed.relationships[0].outstanding_amount, 6759407);
});
test('property rows without a name still link by account number and preserve extra fields', () => {
    const parsed = parsePropertiesSheet([
        { AccountNo: '02844', PlotNo: 'Plot 17', Bedrooms: '3' },
        { PlotNo: 'Unlinked Plot' },
    ]);
    assert.equal(parsed.properties.length, 2);
    assert.equal(parsed.properties[0].account_number, '02844');
    assert.equal(parsed.properties[0].extra_data['Bedrooms'], '3');
});
test('communications without a recognizable type are skipped instead of defaulted', () => {
    const parsed = parseCommunicationsSheet([
        { 'Customer Name': 'Acme Ltd', 'Type': 'Phone Call', 'Notes': 'Left voicemail' },
        { 'Customer Name': 'Beta Ltd', 'Notes': 'No type column' },
    ]);
    assert.equal(parsed.communications.length, 1);
    assert.equal(parsed.communications[0].comm_type, 'CALL');
    assert.equal(parsed.validationResult.errorRows, 1);
    assert.equal(parsed.validationResult.skippedRows?.[0].sourceRowNumber, 3);
    assert.deepEqual(parsed.validationResult.skippedRows?.[0].rawData, {
        'Customer Name': 'Beta Ltd',
        Notes: 'No type column',
    });
});
test('promises require both an amount and a date to be committed', () => {
    const parsed = parsePromiseSheet([
        { 'Customer Name': 'Acme Ltd', 'Promised Amount': '500', 'Promised Date': '2026-11-01' },
        { 'Customer Name': 'Beta Ltd', 'Promised Amount': '500' },
    ]);
    assert.equal(parsed.promises.length, 1);
    assert.equal(parsed.promises[0].status, 'PENDING');
    assert.equal(parsed.validationResult.errorRows, 1);
});
test('entities sharing an account number cluster together even across sheets', () => {
    const { clusterOf, clusterCount } = clusterEntities([
        { customer_name: 'John Kamau', entity_type: 'INDIVIDUAL', account_number: 'ACC001', extra_data: {} },
        { customer_name: 'J. Kamau', entity_type: 'INDIVIDUAL', account_number: 'ACC001', extra_data: {} },
        { customer_name: 'Jane Doe', entity_type: 'INDIVIDUAL', account_number: 'ACC002', extra_data: {} },
    ]);
    assert.equal(clusterCount, 2);
    assert.equal(clusterOf[0], clusterOf[1]);
    assert.notEqual(clusterOf[0], clusterOf[2]);
});
test('conflicting identifiers block automatic merges and retain source provenance', () => {
    const parsed = parseWorkbookSheets([{
            name: 'Accounts',
            rows: [
                { 'Customer Name': 'John Kamau', 'Account Number': 'ACC-1', 'Tax ID': 'TAX-1', Phone: '0712 345 678' },
                { 'Customer Name': 'Jane Kamau', 'Account Number': 'ACC-1', 'Tax ID': 'TAX-2', Phone: '0712 345 678' },
            ],
        }], 'accounts.xlsx');
    assert.equal(parsed.entityClusterCount, 2);
    const conflict = parsed.possibleMatches.find((match) => match.matchType === 'IDENTIFIER_CONFLICT');
    assert.ok(conflict);
    assert.ok(conflict.conflictingEvidence.includes('Tax identifiers differ.'));
    assert.equal(conflict.recommendedAction, 'REVIEW');
    assert.equal(conflict.sourceWorkbook, 'accounts.xlsx');
    assert.deepEqual(conflict.sourceReferencesA, [{ sheetName: 'Accounts', rowNumber: 2 }]);
    assert.deepEqual(conflict.sourceReferencesB, [{ sheetName: 'Accounts', rowNumber: 3 }]);
});
test('exact shared contact details suggest review but never auto-merge', () => {
    const clustered = clusterEntities([
        { customer_name: 'Alex Doe', entity_type: 'INDIVIDUAL', account_number: 'ACC-1', email: 'shared@example.com', extra_data: {} },
        { customer_name: 'Sam Doe', entity_type: 'INDIVIDUAL', account_number: 'ACC-2', email: 'shared@example.com', extra_data: {} },
    ]);
    assert.equal(clustered.clusterCount, 2);
    assert.equal(clustered.possibleMatches[0]?.matchType, 'EMAIL');
    assert.equal(clustered.possibleMatches[0]?.confidence, 75);
    assert.equal(clustered.possibleMatches[0]?.recommendedAction, 'REVIEW');
});
test('review items explain header, duplicate-column, and skipped-row decisions', () => {
    const inspected = inspectSheetMatrix('Accounts', [
        ['Legacy collections export'],
        ['Borrower Name', 'Balance', 'Balance'],
        ['Acme Ltd', '100', '105'],
        ['', '20', '20'],
    ]);
    const unrecognized = inspectSheetMatrix('Raw export', [
        ['Overview'],
        ['Field A', 'Field B'],
        ['alpha', 'beta'],
    ]);
    const parsed = parseWorkbookSheets([inspected, unrecognized], 'legacy.xlsx');
    const items = buildImportReviewItems(parsed, new Map([
        ['Accounts', inspected.inspection],
        ['Raw export', unrecognized.inspection],
    ]));
    assert.deepEqual(items.map((item) => item.type), ['DUPLICATE_COLUMNS', 'INVALID_ROWS', 'UNCERTAIN_HEADER']);
    assert.match(items[0].detail, /first matching column/);
    assert.match(items[0].detail, /original value remains/);
    assert.match(items[1].title, /skipped row/);
    assert.equal(items[2].sheetName, 'Raw export');
});
