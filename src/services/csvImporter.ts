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
 * Universal CSV importer supporting Bitwarden, 1Password, LastPass, Google Chrome, and generic formats
 */
export function parsePasswordCsv(csvContent: string): ParsedCsvItem[] {
  if (!csvContent) return [];
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
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
    if (cols.length <= 1) continue;

    const name = (nameIdx !== -1 && cols[nameIdx]) || cols[0] || 'Imported Password';
    const username = (userIdx !== -1 && cols[userIdx]) || '';
    const password = (passIdx !== -1 && cols[passIdx]) || '';
    const url = (urlIdx !== -1 && cols[urlIdx]) || '';
    const folder = folderIdx !== -1 ? cols[folderIdx] : undefined;
    const notes = notesIdx !== -1 ? cols[notesIdx] : undefined;

    if (name || password || username) {
      items.push({
        name: name.replace(/^"(.*)"$/, '$1'),
        username: username.replace(/^"(.*)"$/, '$1'),
        url: url.replace(/^"(.*)"$/, '$1'),
        password: password.replace(/^"(.*)"$/, '$1'),
        folder: folder ? folder.replace(/^"(.*)"$/, '$1') : undefined,
        notes: notes ? notes.replace(/^"(.*)"$/, '$1') : undefined,
      });
    }
  }

  return items;
}
