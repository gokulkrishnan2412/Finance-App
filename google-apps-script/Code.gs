const SPREADSHEET_ID = '11NCRY2iYR86vffgWAskVLJPypFhhf23P2mLq6nrLiAQ';
const SHEET_DEFINITIONS = {
  Lendings: [
    'id', 'name', 'date', 'principalAmount', 'returnAmount', 'interestAmount',
    'type', 'notes', 'received', 'payments', 'status', 'createdAt', 'duration',
    'weeklyAmount', 'dailyAmount', 'monthlyAmount', 'schedule'
  ],
  Loans: ['id', 'bankName', 'date', 'loanAmount', 'monthlyInterest', 'notes', 'interestPayments', 'createdAt'],
  Chits: ['id', 'personName', 'chitAmount', 'payments', 'notes', 'createdAt']
};

function doGet(event) {
  return route(event, 'GET');
}

function doPost(event) {
  return route(event, 'POST');
}

function route(event, method) {
  try {
    const path = (event.pathInfo || event.parameter.action || '').replace(/^\/+|\/+$/g, '');
    const rawBody = method === 'POST' && event.postData && event.postData.contents ? event.postData.contents : '';
    let payload = event.parameter || {};

    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch (error) {
        payload = Object.assign({}, event.parameter || {});
      }
    }

    switch (path) {
      case 'get_lendings': return respond(readRecords('Lendings'));
      case 'get_loans': return respond(readRecords('Loans'));
      case 'get_chits': return respond(readRecords('Chits'));
      case 'add_lending': return respond(addRecord('Lendings', payload));
      case 'add_loan': return respond(addRecord('Loans', payload));
      case 'add_chit': return respond(addRecord('Chits', payload));
      case 'record_payment': return respond(recordLendingPayment(pathId(event), payload));
      case 'record_loan_interest': return respond(recordLoanInterest(pathId(event), payload));
      case 'record_chit_payment': return respond(recordChitPayment(pathId(event), payload));
      case 'delete_lending': return respond(deleteRecord('Lendings', pathId(event)));
      case 'delete_loan': return respond(deleteRecord('Loans', pathId(event)));
      case 'delete_chit': return respond(deleteRecord('Chits', pathId(event)));
      case 'clear_all': return respond(clearAll());
      default: return respond({ status: 'error', message: 'Unknown action: ' + path });
    }
  } catch (error) {
    return respond({ status: 'error', message: String(error) });
  }
}

function pathId(event) {
  const path = (event.pathInfo || '').replace(/^\/+|\/+$/g, '').split('/');
  return path[1] || event.parameter.id || '';
}

function spreadsheet() {
  if (SPREADSHEET_ID === 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE') {
    throw new Error('Set SPREADSHEET_ID in Code.gs before deploying');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  const book = spreadsheet();
  let sheet = book.getSheetByName(name);
  const headers = SHEET_DEFINITIONS[name];
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function readRecords(name) {
  const sheet = getSheet(name);
  const headers = SHEET_DEFINITIONS[name];
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows.filter(row => row[0] !== '').map(row => deserialize(headers, row));
}

function deserialize(headers, row) {
  const record = {};
  headers.forEach((header, index) => {
    let value = row[index];
    if (['payments', 'interestPayments', 'schedule'].indexOf(header) !== -1 && value) {
      try { value = JSON.parse(value); } catch (error) { /* Keep legacy plain values. */ }
    }
    record[header] = value;
  });
  return record;
}

function serialize(headers, record) {
  return headers.map(header => {
    const value = record[header];
    return ['payments', 'interestPayments', 'schedule'].indexOf(header) !== -1
      ? JSON.stringify(value || [])
      : value === undefined || value === null ? '' : value;
  });
}

function addRecord(name, payload) {
  const headers = SHEET_DEFINITIONS[name];
  const record = Object.assign({}, payload);
  record.id = String(record.id || new Date().getTime());
  record.createdAt = record.createdAt || new Date().toISOString();
  if (name === 'Lendings') {
    record.received = record.received || 0;
    record.payments = record.payments || [];
    record.status = record.status || 'active';
  }
  if (name === 'Loans') record.interestPayments = record.interestPayments || [];
  if (name === 'Chits') record.payments = record.payments || [];
  getSheet(name).appendRow(serialize(headers, record));
  return { status: 'success', [name === 'Lendings' ? 'lending' : name === 'Loans' ? 'loan' : 'chit']: record };
}

function updateRecord(name, record) {
  const sheet = getSheet(name);
  const headers = SHEET_DEFINITIONS[name];
  const idColumn = headers.indexOf('id') + 1;
  const ids = sheet.getRange(2, idColumn, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  for (let index = 0; index < ids.length; index++) {
    if (String(ids[index][0]) === String(record.id)) {
      sheet.getRange(index + 2, 1, 1, headers.length).setValues([serialize(headers, record)]);
      return record;
    }
  }
  return null;
}

function recordLendingPayment(id, payload) {
  const lending = readRecords('Lendings').filter(item => String(item.id) === String(id))[0];
  if (!lending) return { status: 'error', message: 'Lending not found' };
  const amount = Number(payload.amount || 0);
  if (amount <= 0 || !payload.date) return { status: 'error', message: 'A positive amount and date are required' };
  lending.received = Number(lending.received || 0) + amount;
  lending.payments = lending.payments || [];
  lending.payments.push({ date: payload.date, amount: amount });
  if (Number(lending.received) >= Number(lending.returnAmount || 0)) lending.status = 'completed';
  updateRecord('Lendings', lending);
  return { status: 'success', lending: lending };
}

function recordLoanInterest(id, payload) {
  const loan = readRecords('Loans').filter(item => String(item.id) === String(id))[0];
  if (!loan) return { status: 'error', message: 'Loan not found' };
  const amount = Number(payload.amount || 0);
  if (amount <= 0 || !payload.date) return { status: 'error', message: 'A positive amount and date are required' };
  loan.interestPayments = loan.interestPayments || [];
  loan.interestPayments.push({ date: payload.date, amount: amount, note: String(payload.note || '') });
  updateRecord('Loans', loan);
  return { status: 'success', loan: loan };
}

function recordChitPayment(id, payload) {
  const chit = readRecords('Chits').filter(item => String(item.id) === String(id))[0];
  if (!chit) return { status: 'error', message: 'Chit not found' };
  const amount = Number(payload.amount || 0);
  if (amount <= 0 || !payload.date) return { status: 'error', message: 'A positive amount and date are required' };
  chit.payments = chit.payments || [];
  chit.payments.push({ date: payload.date, amount: amount, note: String(payload.note || '') });
  updateRecord('Chits', chit);
  return { status: 'success', chit: chit };
}

function deleteRecord(name, id) {
  const sheet = getSheet(name);
  const rows = readRecords(name);
  const index = rows.findIndex(record => String(record.id) === String(id));
  if (index === -1) return { status: 'error', message: name.slice(0, -1) + ' not found' };
  sheet.deleteRow(index + 2);
  return { status: 'success' };
}

function clearAll() {
  Object.keys(SHEET_DEFINITIONS).forEach(name => {
    const sheet = getSheet(name);
    if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  });
  return { status: 'success' };
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
