export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text';

// Classify a file by extension so the document tools know which codec to use.
// Anything unrecognized is treated as UTF-8 text (markdown, txt, json, code).
export function documentFormat(filePath: string): DocumentFormat {
  const dot = filePath.lastIndexOf('.');
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  switch (ext) {
    case '.pdf':
      return 'pdf';
    case '.docx':
      return 'docx';
    case '.xlsx':
    case '.xls':
    case '.xlsm':
    case '.xlsb':
      return 'xlsx';
    case '.csv':
      return 'csv';
    default:
      return 'text';
  }
}
