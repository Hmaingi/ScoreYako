'use client';

import { useState } from 'react';

type RawDataProps = {
  rawData: {
    raw_data: Record<string, unknown>;
    sheet_name: string;
    created_at: string;
  };
};

export default function RawDataViewer({ rawData }: RawDataProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const entries = Object.entries(rawData.raw_data);
  const filtered = entries.filter(
    ([key, value]) =>
      key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExport = (format: 'csv' | 'json' | 'excel') => {
    let content: string;
    let filename: string;

    if (format === 'json') {
      content = JSON.stringify(rawData.raw_data, null, 2);
      filename = `${rawData.sheet_name}-data.json`;
    } else if (format === 'csv') {
      const headers = entries.map(([k]) => `"${k.replace(/"/g, '""')}"`).join(',');
      const values = entries.map(([, v]) => `"${String(v).replace(/"/g, '""')}"`).join(',');
      content = `${headers}\n${values}`;
      filename = `${rawData.sheet_name}-data.csv`;
    } else {
      // Simple Excel-like format (Tab-separated values)
      const headers = entries.map(([k]) => `"${k.replace(/"/g, '""')}"`).join('\t');
      const values = entries.map(([, v]) => `"${String(v).replace(/"/g, '""')}"`).join('\t');
      content = `${headers}\n${values}`;
      filename = `${rawData.sheet_name}-data.xlsx`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 p-5">
      {/* Search and Controls */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search fields and values..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none min-w-48"
        />
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 transition"
        >
          {showDetails ? 'Hide' : 'Show'} Details
        </button>

        {/* Export Dropdown */}
        <div className="relative group">
          <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition">
            Export
          </button>
          <div className="absolute right-0 top-full mt-1 w-32 bg-slate-800 border border-slate-700 rounded-lg shadow-lg hidden group-hover:block z-10">
            <button
              onClick={() => handleExport('json')}
              className="block w-full px-4 py-2 text-sm text-left text-slate-200 hover:bg-slate-700 first:rounded-t-lg"
            >
              JSON
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="block w-full px-4 py-2 text-sm text-left text-slate-200 hover:bg-slate-700"
            >
              CSV
            </button>
            <button
              onClick={() => handleExport('excel')}
              className="block w-full px-4 py-2 text-sm text-left text-slate-200 hover:bg-slate-700 last:rounded-b-lg"
            >
              Excel (TSV)
            </button>
          </div>
        </div>
      </div>

      {/* Detailed View */}
      {showDetails ? (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map(([key, value]) => (
              <div key={key} className="rounded-lg bg-slate-900/50 p-4 border border-slate-700">
                <h3 className="font-semibold text-sky-300 text-sm uppercase tracking-wide">{key}</h3>
                <p className="mt-2 text-slate-200 text-sm break-words font-mono">{String(value) || <span className="text-slate-500">(empty)</span>}</p>
              </div>
            ))
          ) : (
            <p className="text-slate-400 text-sm py-4">No fields match your search.</p>
          )}
          <p className="text-xs text-slate-500 pt-2 sticky bottom-0 bg-gradient-to-t from-slate-900 to-transparent">
            Showing {filtered.length} of {entries.length} fields
          </p>
        </div>
      ) : (
        /* Table View */
        <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-700 rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/80 border-b border-slate-700">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-slate-300">Field</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-300">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filtered.length > 0 ? (
                filtered.map(([key, value]) => (
                  <tr key={key} className="hover:bg-slate-900/50">
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-300">{key}</td>
                    <td className="px-4 py-2 text-slate-200 truncate max-w-md" title={String(value)}>
                      {String(value) || <span className="text-slate-500">(empty)</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-slate-400 text-sm">
                    No fields match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="flex justify-between items-center text-xs text-slate-500 pt-2">
        <span>Sheet: <strong className="text-slate-300">{rawData.sheet_name}</strong></span>
        <span>
          {searchTerm && (
            <>
              {filtered.length} / {entries.length} fields
            </>
          )}
        </span>
      </div>
    </div>
  );
}
