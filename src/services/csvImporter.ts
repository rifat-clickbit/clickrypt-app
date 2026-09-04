export interface ParsedCsvItem {
  name: string;
  username: string;
  url: string;
  password: string;
  notes?: string;
  folder?: string;
}

/**
 * Robust CSV line tokenizer that respects quoted strings with commas and escaped quotes
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Strip formula injection characters and surrounding quotes
 */
function sanitizeCsvValue(val: string): string {
  if (!val) return '';
  let clean = val.replace(/^"(.*)"$/, '$1').trim();
  // Strip leading formula execution characters (=, +, -, @, \t, \r) to prevent CSV Injection
  clean = clean.replace(/^[=+\-@\t\r]+/, '');
  return clean;
}

/**
 * Universal CSV importer supporting Bitwarden, 1Password, LastPass, Google Chrome, and generic formats
 */
export function parsePasswordCsv(csvContent: string): ParsedCsvItem[] {
  if (!csvContent || !csvContent.trim()) {
    throw new Error('CSV file is empty.');
  }

  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  if (lines.length - 1 > 1000) {
    throw new Error('CSV file exceeds the maximum limit of 1,000 items per import batch. Please split your file.');
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

  // Validate that the CSV has recognized credential headers
  const recognizedHeaderKeywords = [
    'name',
    'title',
    'item_name',
    'password',
    'login_password',
    'secret',
    'username',
    'login_username',
    'user',
    'email',
    'url',
    'website',
    'login_uri',
  ];

  const hasRecognizedHeader = headers.some((h) => recognizedHeaderKeywords.includes(h));
  if (!hasRecognizedHeader) {
    throw new Error(
      'Unrecognized CSV format. The file must contain standard credential headers (e.g. name, title, username, password, url).'
    );
  }

  const items: ParsedCsvItem[] = [];

  // Identify column indices
  let nameIdx = headers.findIndex((h) => h === 'name' || h === 'title' || h === 'item_name');
  let userIdx = headers.findIndex(
    (h) => h === 'username' || h === 'login_username' || h === 'user' || h === 'email'
  );
  let passIdx = headers.findIndex((h) => h === 'password' || h === 'login_password' || h === 'secret');
  let urlIdx = headers.findIndex(
    (h) => h === 'url' || h === 'website' || h === 'login_uri' || h === 'uri' || h === 'link'
  );
  let folderIdx = headers.findIndex((h) => h === 'folder' || h === 'grouping' || h === 'category');
  let notesIdx = headers.findIndex((h) => h === 'notes' || h === 'extra' || h === 'comment');

  // Fallbacks if headers are slightly non-standard
  if (nameIdx === -1) nameIdx = 0;
  if (userIdx === -1) userIdx = 1;
  if (passIdx === -1) passIdx = 2;
  if (urlIdx === -1) urlIdx = 3;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length <= 1 && !cols[0]) continue;

    const rawName = (nameIdx !== -1 && cols[nameIdx]) || cols[0] || '';
    const rawUser = (userIdx !== -1 && cols[userIdx]) || '';
    const rawPass = (passIdx !== -1 && cols[passIdx]) || '';
    const rawUrl = (urlIdx !== -1 && cols[urlIdx]) || '';
    const rawFolder = folderIdx !== -1 ? cols[folderIdx] : undefined;
    const rawNotes = notesIdx !== -1 ? cols[notesIdx] : undefined;

    const name = sanitizeCsvValue(rawName).slice(0, 100);
    const username = sanitizeCsvValue(rawUser).slice(0, 255);
    const password = sanitizeCsvValue(rawPass).slice(0, 1000);
    const url = sanitizeCsvValue(rawUrl).slice(0, 2048);
    const folder = rawFolder ? sanitizeCsvValue(rawFolder).slice(0, 50) : undefined;
    const notes = rawNotes ? sanitizeCsvValue(rawNotes).slice(0, 50000) : undefined;

    if (name || password || username) {
      items.push({
        name: name || 'Imported Password',
        username,
        url,
        password,
        folder,
        notes,
      });
    }
  }

  if (items.length === 0) {
    throw new Error('No valid credential records could be found in this CSV file.');
  }

  return items;
}
