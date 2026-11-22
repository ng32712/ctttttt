import { useState } from 'react';

type TabKey = 'clients' | 'invoice' | 'finances' | 'overview';

export default function SoloBizInteractivePreview({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('overview');

  const tabs: { id: TabKey; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'clients', label: 'Clients' },
    { id: 'invoice', label: 'Quote & Invoice' },
    { id: 'finances', label: 'Income & Expense' },
  ];

  return (
    <div className="rounded-2xl bg-[#FAF9F5] border border-[#E5E2D8] shadow-md overflow-hidden">
      <div className="px-4 py-3 bg-[#F3F1EA] border-b border-[#E5E2D8] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-[#23242B]">
            SoloBiz OS.xlsx
          </span>
          <span className="text-xs text-[#6B6A64]">· Interactive Preview</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 bg-[#FAF9F5] p-1 rounded-lg border border-[#E5E2D8]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                tab === t.id
                  ? 'bg-[#23242B] text-[#FAF9F5]'
                  : 'text-[#6B6A64] hover:text-[#23242B]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={compact ? 'p-4' : 'p-5 md:p-6'}>
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#F3F1EA] border border-[#E5E2D8]">
                <p className="text-[11px] text-[#6B6A64]">Monthly Invoiced</p>
                <p className="font-mono-tabular font-bold text-lg text-[#23242B] mt-0.5">
                  $2,450
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F3F1EA] border border-[#E5E2D8]">
                <p className="text-[11px] text-[#6B6A64]">Pending Follow-Up</p>
                <p className="font-mono-tabular font-bold text-lg text-[#23242B] mt-0.5">
                  $680
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#E56B5D]/10 border border-[#E56B5D]/25">
                <p className="text-[11px] text-[#6B6A64]">Net Margin</p>
                <p className="font-mono-tabular font-bold text-lg text-[#E56B5D] mt-0.5">
                  84%
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[#E5E2D8] overflow-hidden bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F3F1EA] text-[#6B6A64]">
                  <tr>
                    <th className="py-2 px-3 font-medium">Module Tab</th>
                    <th className="py-2 px-3 font-medium">Purpose</th>
                    <th className="py-2 px-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E2D8] text-[#23242B]">
                  <tr>
                    <td className="py-2 px-3 font-medium">Client Tracker</td>
                    <td className="py-2 px-3 text-[#6B6A64]">Leads, active work, follow-up dates</td>
                    <td className="py-2 px-3 text-right font-mono-tabular text-[#E56B5D]">Ready</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium">Quote &amp; Invoice</td>
                    <td className="py-2 px-3 text-[#6B6A64]">Itemized PDF-ready client billing</td>
                    <td className="py-2 px-3 text-right font-mono-tabular text-[#E56B5D]">Ready</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium">Follow-Up Log</td>
                    <td className="py-2 px-3 text-[#6B6A64]">Due dates &amp; polite reminder log</td>
                    <td className="py-2 px-3 text-right font-mono-tabular text-[#E56B5D]">Ready</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'clients' && (
          <div className="rounded-xl border border-[#E5E2D8] overflow-x-auto bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F3F1EA] text-[#6B6A64]">
                <tr>
                  <th className="py-2 px-3 font-medium">Sample Client</th>
                  <th className="py-2 px-3 font-medium">Scope</th>
                  <th className="py-2 px-3 font-medium">Stage</th>
                  <th className="py-2 px-3 font-medium text-right">Next Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2D8] text-[#23242B]">
                <tr>
                  <td className="py-2.5 px-3 font-medium">Kivu Coffee Co.</td>
                  <td className="py-2.5 px-3 text-[#6B6A64]">Packaging Audit</td>
                  <td className="py-2.5 px-3">Quote Sent</td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular">Nov 24</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">Northwind Lab</td>
                  <td className="py-2.5 px-3 text-[#6B6A64]">Web Prototype</td>
                  <td className="py-2.5 px-3 text-[#E56B5D] font-medium">Active</td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular">Nov 27</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">Atelier Nine</td>
                  <td className="py-2.5 px-3 text-[#6B6A64]">Copy Sprint</td>
                  <td className="py-2.5 px-3">Completed</td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular">Paid</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === 'invoice' && (
          <div className="rounded-xl border border-[#E5E2D8] bg-white p-4 space-y-3 text-xs">
            <div className="flex items-start justify-between border-b border-[#E5E2D8] pb-3">
              <div>
                <p className="font-semibold text-sm text-[#23242B]">
                  INVOICE #INV-104 (Sample)
                </p>
                <p className="text-[#6B6A64]">Issued Nov 20, 2026 · Due Dec 04, 2026</p>
              </div>
              <span className="font-mono-tabular font-bold text-sm text-[#E56B5D]">
                $680.00
              </span>
            </div>
            <div className="space-y-1.5 text-[#6B6A64]">
              <div className="flex justify-between">
                <span>Brand Strategy &amp; Wireframe Sprint</span>
                <span className="font-mono-tabular text-[#23242B]">$500.00</span>
              </div>
              <div className="flex justify-between">
                <span>Asset Handoff &amp; Style Guide</span>
                <span className="font-mono-tabular text-[#23242B]">$180.00</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'finances' && (
          <div className="rounded-xl border border-[#E5E2D8] overflow-x-auto bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F3F1EA] text-[#6B6A64]">
                <tr>
                  <th className="py-2 px-3 font-medium">Date</th>
                  <th className="py-2 px-3 font-medium">Entry</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2D8] text-[#23242B]">
                <tr>
                  <td className="py-2 px-3 font-mono-tabular">2026-11-18</td>
                  <td className="py-2 px-3">Client Deposit — Northwind</td>
                  <td className="py-2 px-3 text-[#E56B5D] font-medium">Income</td>
                  <td className="py-2 px-3 text-right font-mono-tabular">+$1,200.00</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono-tabular">2026-11-14</td>
                  <td className="py-2 px-3">Domain &amp; Hosting Renewal</td>
                  <td className="py-2 px-3 text-[#6B6A64]">Expense</td>
                  <td className="py-2 px-3 text-right font-mono-tabular">-$42.00</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono-tabular">2026-11-08</td>
                  <td className="py-2 px-3">Atelier Nine Final Balance</td>
                  <td className="py-2 px-3 text-[#E56B5D] font-medium">Income</td>
                  <td className="py-2 px-3 text-right font-mono-tabular">+$1,250.00</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
