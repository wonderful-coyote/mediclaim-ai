'use client';

import { useState, useEffect } from 'react';

// --- THE MASTER API SWITCH ---
const API_BASE_URL = "https://wonderfulcoyote-mediclaim-ai.hf.space";

interface Claim {
  claim_id: string;
  procedure_name: string;
  total_cost: number;
  deducted_amount: number;
  hmo_payout: number;
  settlement_status: string;
  timestamp: string;
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [selectedAdmin, setSelectedAdmin] = useState<string>("CFO-001");
  const [password, setPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<boolean>(false);

  const [wallet, setWallet] = useState({ available_balance: 0, pending_escrow: 0 });
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedAdmin === "CFO-001" && password === "123") {
      setIsAuthenticated(true);
      setLoading(true);
      setLoginError(false);
    } else {
      setLoginError(true);
      setPassword("");
    }
  };

  useEffect(() => {
    let isMounted = true;
    const fetchDashboardData = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/admin/hospital-wallet`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setWallet(data.wallet);
            setClaims(data.recent_claims);
            setLoading(false); // ✅ This is now utilized below!
          }
        }
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        if (isMounted) setLoading(false);
      }
    };

    if (isAuthenticated) {
      fetchDashboardData(); 
      const interval = setInterval(fetchDashboardData, 3000); 
      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }
  }, [isAuthenticated]); 

  const handleApprove = async (claimId: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/admin/consultant-approve/${claimId}`, { method: 'POST' });
      const res = await fetch(`${API_BASE_URL}/api/v1/admin/hospital-wallet`);
      if (res.ok) {
        const data = await res.json();
        setWallet(data.wallet);
        setClaims(data.recent_claims);
      }
    } catch (error) {
      console.error("Failed to approve claim:", error);
    }
  };

  const formatNaira = (amount: number) => {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount || 0);
  };

  // ==========================================
  // 🛑 RENDER 1: THE LOGIN SCREEN
  // ==========================================
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-10 rounded-3xl shadow-2xl">
          <div className="w-16 h-16 bg-indigo-600 rounded-full mx-auto mb-6 flex items-center justify-center">
            <span className="text-white text-2xl font-black">M</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mb-2 text-center">MediClaim Enterprise</h1>
          <p className="text-sm text-slate-400 mb-8 text-center">Authenticate to access the CFO Financial Terminal.</p>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Administrator Identity</label>
              <select value={selectedAdmin} onChange={(e) => setSelectedAdmin(e.target.value)} className="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-white outline-none focus:border-indigo-500 font-bold">
                <option value="CFO-001">CFO-001 (Chief Financial Officer)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Secure PIN</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="PIN (123)" className={`w-full p-4 rounded-xl bg-slate-800 border text-white outline-none focus:border-indigo-500 tracking-widest ${loginError ? "border-rose-500" : "border-slate-700"}`} />
              {loginError && <p className="text-rose-500 text-xs mt-2 font-bold">Invalid Authorization PIN.</p>}
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition-colors mt-4">Access Terminal</button>
          </form>
        </div>
      </main>
    );
  }

  // ==========================================
  // 🟡 RENDER 2: THE LOADING SCREEN (Fixes ESLint)
  // ==========================================
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans p-6 text-slate-600 font-bold animate-pulse">
        Loading CFO Dashboard...
      </div>
    );
  }

  // ==========================================
  // 🟢 RENDER 3: THE DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col relative">
      
      {/* 🌟 MATCHING HEADER */}
      <div className="w-full bg-slate-900 text-white p-3 flex justify-between items-center px-6 shadow-md z-40 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-indigo-400 animate-pulse" />
          <span className="font-black tracking-tight text-lg text-slate-100 hidden md:block">
            MediClaim <span className="font-medium text-slate-400">Enterprise</span>
          </span>
        </div>
        <div className="flex items-center gap-4 bg-slate-800 rounded-lg p-1.5 border border-slate-700 pr-4">
          <div className="text-white w-8 h-8 rounded-md flex items-center justify-center font-bold text-[10px] uppercase bg-indigo-600">CFO</div>
          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-bold leading-none">{selectedAdmin}</span>
            <span className="text-[9px] text-slate-400 uppercase">Administration</span>
          </div>
          <div className="h-6 w-px bg-slate-600 mx-2" />
          <button onClick={() => { setIsAuthenticated(false); setPassword(""); }} className="text-[10px] uppercase tracking-widest font-black text-rose-400 hover:text-rose-300">Log Out</button>
        </div>
      </div>

      <main className="flex-1 p-6 md:p-12 max-w-6xl w-full mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Hospital CFO Dashboard</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Real-time HMO Settlement & Escrow Management</p>
        </div>

        {/* 💳 METRIC CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          
          <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden flex flex-col justify-between">
            <div className="absolute -right-4 -top-4 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />
            <div className="relative z-10">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Available Balance (Settled)
              </p>
              <h2 className="text-4xl md:text-5xl font-black text-emerald-400 tracking-tighter mt-2">{formatNaira(wallet.available_balance)}</h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-4">Funds cleared for hospital use</p>
            </div>
          </div>

          <div className="bg-amber-50 p-8 rounded-3xl shadow-xl border border-amber-200 relative overflow-hidden flex flex-col justify-between">
            <div className="relative z-10">
              <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Pending Escrow (Unsettled)
              </p>
              <h2 className="text-4xl md:text-5xl font-black text-amber-600 tracking-tighter mt-2">{formatNaira(wallet.pending_escrow)}</h2>
              <p className="text-[10px] text-amber-700/60 font-bold uppercase tracking-widest mt-4">Awaiting Consultant / HMO Authorization</p>
            </div>
          </div>

        </div>

        {/* 📊 LEDGER TABLE */}
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h2 className="text-lg font-black text-slate-800 tracking-tight">Recent Claims Ledger</h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{claims.length} Records</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                  <th className="p-6">Claim ID</th>
                  <th className="p-6">Procedure</th>
                  <th className="p-6">Total Cost</th>
                  <th className="p-6 text-indigo-600">Pt Co-Pay (Interswitch)</th>
                  <th className="p-6">HMO Payout</th>
                  <th className="p-6">HMO Status</th>
                  <th className="p-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {claims.map((claim: Claim) => (
                  <tr key={claim.claim_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-6 text-xs font-mono font-bold text-slate-500">{claim.claim_id.substring(0,8)}...</td>
                    <td className="p-6 text-sm font-black text-slate-800">{claim.procedure_name}</td>
                    <td className="p-6 text-sm font-bold text-slate-400">{formatNaira(claim.total_cost)}</td>
                    <td className="p-6 text-sm font-black text-emerald-500">{formatNaira(claim.deducted_amount)}</td>
                    <td className="p-6 text-sm font-black text-slate-700">{formatNaira(claim.hmo_payout)}</td>
                    <td className="p-6">
                      <span className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg border ${
                        claim.settlement_status === 'INSTANT_SETTLED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        claim.settlement_status === 'SETTLED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        claim.settlement_status === 'HMO_AUDIT_REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                        'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {claim.settlement_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-6 text-right">
                      {(claim.settlement_status === 'PENDING_CONSULTANT' || claim.settlement_status === 'PENDING_TIMER') && (
                        <button 
                          onClick={() => handleApprove(claim.claim_id)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-md transition-all"
                        >
                          Authorize
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {claims.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400 font-bold italic">No claims processed yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}