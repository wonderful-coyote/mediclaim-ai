'use client';

import { useEffect, useMemo, useState } from 'react';

const API_BASE_URL = "https://wonderfulcoyote-mediclaim-ai.hf.space";
// const API_BASE_URL = "http://127.0.0.1:8000";

type FilterType = 'ALL' | 'HMO' | 'SELF_PAY' | 'POS' | 'REJECTED';

interface Message {
  senderRole?: 'HO' | 'HMO';
  senderName?: string;
  text?: string;
  time?: string;
}

interface Claim {
  claim_id: string;
  patient_id: string;
  procedure_name: string;
  total_cost: number;
  deducted_amount: number;
  hmo_payout: number;
  settlement_status: string;
  timestamp: string;
  doctor_name: string;
  resolved_by: string;
  ai_score: number;
  paycode: string | null;
  status: string;
  reasoning: string;
  clinical_indication?: string;
  notes?: string;
  ai_reasoning?: string;
  suggestions_json?: string;
  messages_json?: string;
}

interface WalletSnapshot {
  available_balance: number;
  pending_escrow: number;
}

const parseJsonArray = <T,>(value?: string): T[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const formatNaira = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount || 0);

const getClaimTone = (claim: Claim): 'emerald' | 'indigo' | 'amber' | 'rose' | 'slate' => {
  const settlement = String(claim.settlement_status || '').toUpperCase();
  const outOfPocketTotal = Math.max((claim.total_cost || 0) - (claim.hmo_payout || 0), 0);
  const outstanding = Math.max(outOfPocketTotal - (claim.deducted_amount || 0), 0);

  if (settlement.includes('REJECTED') || claim.status === 'REJECTED') return 'rose';
  if (settlement.startsWith('PATIENT_RESPONSIBLE')) return outstanding > 0 ? 'amber' : 'indigo';
  if (claim.hmo_payout > 0 && outstanding <= 0) return 'emerald';
  if (claim.hmo_payout > 0 && outstanding > 0) return 'amber';
  return 'slate';
};

const badgeClass: Record<'emerald' | 'indigo' | 'amber' | 'rose' | 'slate', string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
};

const getClaimLabel = (claim: Claim): string => {
  const settlement = String(claim.settlement_status || '').toUpperCase();
  const outOfPocketTotal = Math.max((claim.total_cost || 0) - (claim.hmo_payout || 0), 0);
  const outstanding = Math.max(outOfPocketTotal - (claim.deducted_amount || 0), 0);

  if (settlement.includes('REJECTED') || claim.status === 'REJECTED') return 'Rejected';
  if (settlement.startsWith('PATIENT_RESPONSIBLE')) return outstanding > 0 ? 'Self-Pay Pending' : 'Self-Pay Cleared';
  if (settlement === 'FULLY_SETTLED') return 'Fully Settled';
  if (settlement === 'HMO_APPROVED_PENDING_PT') return outstanding > 0 ? 'Co-Pay Pending' : 'Awaiting HMO Release';
  if (settlement === 'INSTANT_SETTLED') return 'Instant Approved';
  return claim.status || 'Open';
};

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [selectedAdmin] = useState<string>('CFO-001');
  const [password, setPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [filterType, setFilterType] = useState<FilterType>('ALL');
  const [wallet, setWallet] = useState<WalletSnapshot>({ available_balance: 0, pending_escrow: 0 });
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);

  const fetchDashboardData = async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/hospital-wallet`);
      if (!res.ok) throw new Error('Failed to fetch dashboard');
      const data = await res.json();
      setWallet(data.wallet || { available_balance: 0, pending_escrow: 0 });
      setClaims(Array.isArray(data.recent_claims) ? data.recent_claims : []);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    if (isAuthenticated) {
      setLoading(true);
      void fetchDashboardData();
      const interval = setInterval(() => {
        if (mounted) void fetchDashboardData();
      }, 3000);
      return () => {
        mounted = false;
        clearInterval(interval);
      };
    }
  }, [isAuthenticated]);

  const handleLogin = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (password === '123') {
      setIsAuthenticated(true);
      setLoginError(false);
    } else {
      setLoginError(true);
      setPassword('');
    }
  };

  const handleClearPOS = async (claimId: string): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/admin/clear-pos-payment/${claimId}`, { method: 'POST' });
      await fetchDashboardData();
    } catch (error) {
      console.error('Failed to clear POS payment:', error);
    }
  };

  const filteredClaims = useMemo(() => {
    return claims.filter((claim: Claim) => {
      const settlement = String(claim.settlement_status || '').toUpperCase();
      const outOfPocketTotal = Math.max((claim.total_cost || 0) - (claim.hmo_payout || 0), 0);
      const outstanding = Math.max(outOfPocketTotal - (claim.deducted_amount || 0), 0);
      const isRejected = settlement.includes('REJECTED') || claim.status === 'REJECTED';
      const isSelfPay = settlement.startsWith('PATIENT_RESPONSIBLE') || ((claim.hmo_payout || 0) <= 0 && (claim.total_cost || 0) > 0 && !isRejected);
      const needsPos = outstanding > 0 && !!claim.paycode;

      if (filterType === 'ALL') return true;
      if (filterType === 'REJECTED') return isRejected;
      if (filterType === 'SELF_PAY') return isSelfPay;
      if (filterType === 'POS') return needsPos;
      if (filterType === 'HMO') return !isRejected && !isSelfPay;
      return true;
    });
  }, [claims, filterType]);

  const fraudPrevented = useMemo(
    () => claims.filter((c: Claim) => String(c.settlement_status || '').includes('REJECTED')).reduce((acc: number, curr: Claim) => acc + (curr.total_cost || 0), 0),
    [claims],
  );

  const selfPayOutstanding = useMemo(
    () =>
      claims.reduce((acc: number, claim: Claim) => {
        const settlement = String(claim.settlement_status || '').toUpperCase();
        if (!settlement.startsWith('PATIENT_RESPONSIBLE')) return acc;
        const total = Math.max((claim.total_cost || 0) - (claim.hmo_payout || 0), 0);
        const outstanding = Math.max(total - (claim.deducted_amount || 0), 0);
        return acc + outstanding;
      }, 0),
    [claims],
  );


  const stpCount = claims.filter((c: Claim) => (c.hmo_payout || 0) > 0 && ['INSTANT_SETTLED', 'FULLY_SETTLED', 'HMO_APPROVED_PENDING_PT'].includes(String(c.settlement_status || '').toUpperCase())).length;
  const aiAutomationRate = claims.length > 0 ? Math.round((stpCount / claims.length) * 100) : 0;

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-10 rounded-3xl shadow-2xl">
          <div className="w-16 h-16 bg-indigo-600 rounded-full mx-auto mb-6 flex items-center justify-center">
            <span className="text-white text-2xl font-black">MC</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mb-2 text-center">MediClaim Enterprise</h1>
          <p className="text-sm text-slate-400 mb-8 text-center">Authenticate to access the Revenue & Audit Terminal.</p>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Administrator Identity</label>
              <div className="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold">{selectedAdmin} (Chief Financial Officer)</div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Secure PIN</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="PIN (123)" className={`w-full p-4 rounded-xl bg-slate-800 border text-white outline-none focus:border-indigo-500 tracking-widest ${loginError ? 'border-rose-500' : 'border-slate-700'}`} />
              {loginError && <p className="text-rose-500 text-xs mt-2 font-bold">Invalid Authorization PIN.</p>}
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition-colors mt-4">Access Terminal</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col relative">
      {selectedClaim && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-5xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-start gap-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Stored CFO Claim Record</p>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">{selectedClaim.procedure_name}</h3>
                <p className="text-xs text-slate-500 mt-1">{selectedClaim.patient_id} • {selectedClaim.doctor_name} • {new Date(selectedClaim.timestamp).toLocaleString()}</p>
              </div>
              <button onClick={() => setSelectedClaim(null)} className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl">Close</button>
            </div>
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">AI Score</p><p className="text-3xl font-black text-slate-800">{Math.round((selectedClaim.ai_score || 0) * 100)}%</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Status</p><p className="font-black text-slate-800 wrap-break-word">{selectedClaim.status || '-'}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Settlement</p><p className="font-black text-slate-800 wrap-break-word whitespace-normal">{selectedClaim.settlement_status || '-'}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Resolved By</p><p className="font-black text-slate-800 wrap-break-word">{selectedClaim.resolved_by || '-'}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Clinical Notes</p><p className="text-slate-700 leading-relaxed wrap-break-word whitespace-pre-wrap">{selectedClaim.notes || 'No notes stored.'}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Financial Snapshot</p><div className="space-y-2 text-sm"><div className="flex justify-between gap-4"><span className="text-slate-500">Total Cost</span><span className="font-black text-slate-800">{formatNaira(selectedClaim.total_cost || 0)}</span></div><div className="flex justify-between gap-4"><span className="text-slate-500">HMO Payout</span><span className="font-black text-indigo-600">{formatNaira(selectedClaim.hmo_payout || 0)}</span></div><div className="flex justify-between gap-4"><span className="text-slate-500">Patient Deducted</span><span className="font-black text-emerald-600">{formatNaira(selectedClaim.deducted_amount || 0)}</span></div><div className="flex justify-between gap-4"><span className="text-slate-500">Paycode</span><span className="font-black text-slate-800 break-all text-right">{selectedClaim.paycode || '-'}</span></div></div></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Clinical Indication</p><p className="text-slate-700 leading-relaxed wrap-break-word">{selectedClaim.clinical_indication || 'No indication stored.'}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">AI Reasoning</p><p className="text-slate-700 leading-relaxed wrap-break-word whitespace-pre-wrap">{selectedClaim.ai_reasoning || selectedClaim.reasoning || 'No reasoning stored.'}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Debugger & Suggestions</p>{parseJsonArray<string>(selectedClaim.suggestions_json).length > 0 ? <ul className="list-disc pl-5 space-y-1 text-slate-700">{parseJsonArray<string>(selectedClaim.suggestions_json).map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-slate-500 italic">No suggestions stored.</p>}</div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Communication Log</p>{parseJsonArray<Message>(selectedClaim.messages_json).length > 0 ? <div className="space-y-2">{parseJsonArray<Message>(selectedClaim.messages_json).map((msg, idx) => <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{msg.senderName || 'System'}{msg.time ? ` • ${msg.time}` : ''}</p><p className="text-slate-700 wrap-break-word whitespace-pre-wrap">{msg.text || ''}</p></div>)}</div> : <p className="text-slate-500 italic">No communication stored.</p>}</div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full bg-slate-900 text-white p-3 flex justify-between items-center px-6 shadow-md z-40 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-indigo-400 animate-pulse" />
          <span className="font-black tracking-tight text-lg text-slate-100 hidden md:block">MediClaim <span className="font-medium text-slate-400">Enterprise</span></span>
        </div>
        <div className="flex items-center gap-4 bg-slate-800 rounded-lg p-1.5 border border-slate-700 pr-4">
          <div className="text-white w-8 h-8 rounded-md flex items-center justify-center font-bold text-[10px] uppercase bg-indigo-600">CFO</div>
          <div className="hidden sm:flex flex-col"><span className="text-xs font-bold leading-none">{selectedAdmin}</span><span className="text-[9px] text-slate-400 uppercase">Administration</span></div>
          <div className="h-6 w-px bg-slate-600 mx-2" />
          <button onClick={() => { setIsAuthenticated(false); setPassword(''); }} className="text-[10px] uppercase tracking-widest font-black text-rose-400 hover:text-rose-300">Log Out</button>
        </div>
      </div>

      <main className="flex-1 p-6 md:p-12 max-w-375 w-full mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Revenue Cycle & AI Audit Dashboard</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Real-time adjudication, self-pay tracking, fraud prevention, and remittance visibility.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-10">
          <div className="bg-slate-900 p-6 rounded-3xl text-white shadow-xl"><p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">Approved HMO Receivables</p><h2 className="text-2xl lg:text-3xl font-black tracking-tighter mt-1">{formatNaira(wallet.pending_escrow)}</h2><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-3">Expected HMO remittance</p></div>
          <div className="bg-white p-6 rounded-3xl shadow-md border border-slate-200"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Patient Cash Collected</p><h2 className="text-2xl lg:text-3xl font-black text-slate-800 tracking-tighter mt-1">{formatNaira(wallet.available_balance)}</h2><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-3">Wallet / POS cash realized</p></div>
          <div className="bg-amber-50 p-6 rounded-3xl shadow-md border border-amber-200"><p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1">Self-Pay Outstanding</p><h2 className="text-2xl lg:text-3xl font-black text-rose-600 tracking-tighter mt-1">{formatNaira(selfPayOutstanding)}</h2><p className="text-[9px] text-amber-700/70 font-bold uppercase tracking-widest mt-3">Still due from patients</p></div>
          <div className="bg-rose-50 p-6 rounded-3xl shadow-md border border-rose-200"><p className="text-[9px] font-black text-rose-600 uppercase tracking-widest mb-1">Fraud / Waste Prevented</p><h2 className="text-2xl lg:text-3xl font-black text-rose-700 tracking-tighter mt-1">{formatNaira(fraudPrevented)}</h2><p className="text-[9px] text-rose-600/70 font-bold uppercase tracking-widest mt-3">Auto / policy rejects</p></div>
          <div className="bg-emerald-50 p-6 rounded-3xl shadow-md border border-emerald-200"><p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1">AI Automation Efficiency</p><h2 className="text-2xl lg:text-3xl font-black text-emerald-600 tracking-tighter mt-1">{aiAutomationRate}%</h2><p className="text-[9px] text-emerald-700/70 font-bold uppercase tracking-widest mt-3">High-confidence automation</p></div>
        </div>

        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight">Master Claims & Audit Ledger</h2>
              <p className="text-xs text-slate-500 mt-1">HMO-funded, self-pay, rejected, and cashier-clearance flows in one place.</p>
            </div>
            <div className="flex flex-wrap bg-slate-200/50 p-1 rounded-xl gap-1">
              {(['ALL', 'HMO', 'SELF_PAY', 'POS', 'REJECTED'] as FilterType[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setFilterType(filter)}
                  className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${filterType === filter ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {filter === 'SELF_PAY' ? 'Self Pay' : filter === 'POS' ? 'Cashier / POS' : filter}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 font-bold animate-pulse">Loading finance dashboard…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-325">
                <thead>
                  <tr className="bg-white text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="p-4 pl-6">Clinical Details</th>
                    <th className="p-4">Commercial Status</th>
                    <th className="p-4">Total Value</th>
                    <th className="p-4">HMO Exposure</th>
                    <th className="p-4">Patient Exposure</th>
                    <th className="p-4 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredClaims.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-slate-400 font-bold italic">No matching claims found.</td>
                    </tr>
                  ) : (
                    filteredClaims.map((claim: Claim) => {
                      const outOfPocketTotal = Math.max((claim.total_cost || 0) - (claim.hmo_payout || 0), 0);
                      const coPayOwed = Math.max(outOfPocketTotal - (claim.deducted_amount || 0), 0);
                      const tone = getClaimTone(claim);
                      const label = getClaimLabel(claim);
                      const isRejected = tone === 'rose';
                      const isSelfPay = String(claim.settlement_status || '').toUpperCase().startsWith('PATIENT_RESPONSIBLE');

                      return (
                        <tr key={claim.claim_id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 pl-6 align-top">
                            <p className="text-sm font-black text-slate-800">{claim.procedure_name} <span className="text-indigo-600 font-bold text-xs ml-1">for {claim.patient_id}</span></p>
                            <p className="text-[10px] text-slate-500 mt-1.5">Ordered by: <span className="font-bold">{claim.doctor_name}</span></p>
                            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-mono mt-1.5 mb-2">{claim.claim_id}</p>
                            <p className="text-[11px] text-slate-500 leading-relaxed max-w-sm">{claim.reasoning || 'No AI reasoning stored.'}</p>
                          </td>
                          <td className="p-4 align-top">
                            <span className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg border mb-2 inline-block ${badgeClass[tone]}`}>{label}</span>
                            <div className="text-[10px] text-slate-500 space-y-1">
                              <p><span className="font-black text-slate-700">Settlement:</span> <span className="wrap-break-word">{claim.settlement_status || '-'}</span></p>
                              <p><span className="font-black text-slate-700">AI Score:</span> {Math.round((claim.ai_score || 0) * 100)}%</p>
                              <p><span className="font-black text-slate-700">Resolver:</span> {claim.resolved_by || '-'}</p>
                            </div>
                          </td>
                          <td className="p-4 align-top pt-5 text-sm font-bold text-slate-800">{formatNaira(claim.total_cost || 0)}</td>
                          <td className="p-4 align-top pt-5">
                            <span className={`text-sm font-black ${isRejected || isSelfPay ? 'text-slate-400' : 'text-indigo-600'}`}>{formatNaira(claim.hmo_payout || 0)}</span>
                            <br />
                            <span className="text-[8px] uppercase tracking-widest font-bold mt-1 block text-slate-400">{isSelfPay ? 'NO HMO FUNDING' : isRejected ? 'DENIED' : 'HMO TRACK'}</span>
                          </td>
                          <td className="p-4 align-top pt-5">
                            <span className={`text-sm font-black ${coPayOwed > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatNaira(claim.deducted_amount || 0)} Collected</span>
                            <p className="text-[10px] text-slate-500 mt-1">Outstanding: <span className="font-black text-slate-700">{formatNaira(coPayOwed)}</span></p>
                          </td>
                          <td className="p-4 pr-6 text-right align-top pt-4">
                            <div className="flex flex-col gap-2 items-end">
                              <button onClick={() => setSelectedClaim(claim)} className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-[9px] font-black uppercase tracking-widest rounded-lg shadow-sm transition-all">View</button>
                              {claim.paycode && coPayOwed > 0 && (
                                <button onClick={() => handleClearPOS(claim.claim_id)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg shadow-md transition-all flex flex-col items-center justify-center">
                                  <span>Clear POS Code</span>
                                  <span className="font-mono mt-0.5 text-xs">{claim.paycode}</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
