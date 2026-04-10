"use client";
import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = "https://wonderfulcoyote-mediclaim-ai.hf.space";
// const API_BASE_URL = "http://127.0.0.1:8000";

interface Message {
  senderRole: "HO" | "HMO";
  senderName: string;
  text: string;
  time: string;
}

interface QueuedClaim {
  id: string;
  doctorName: string;
  testName: string;
  notes: string;
  aiScore: number;
  aiReasoning: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "DISPATCHED";
  messages: Message[];
  deductedAmount: number;
  clinicalIndication?: string;
  total_cost?: number;
  hmo_payout?: number;
  patientId?: string;
  suggestions?: string[];
  payout_tier?: string;
  paycode?: string;
  settlement_status?: string;
  resolvedBy?: string;
  isArchived?: boolean;
}

interface StoredClaim {
  claim_id: string;
  patient_id: string;
  doctor_name: string;
  procedure_name: string;
  clinical_indication?: string;
  ai_score: number;
  status: string;
  resolved_by?: string;
  deducted_amount: number;
  paycode?: string | null;
  total_cost: number;
  hmo_payout: number;
  settlement_status?: string;
  reasoning?: string;
  timestamp?: string;
  notes?: string;
  ai_reasoning?: string;
  messages?: Message[];
  suggestions?: string[];
  updated_at?: string;
}

type TabKey = "QUEUE" | "HISTORY";

export default function HMOBenefitsDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [selectedAuditor, setSelectedAuditor] = useState<string>("HMO-AUDIT-01");
  const [password, setPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<boolean>(false);

  const [reviewQueue, setReviewQueue] = useState<QueuedClaim[]>([]);
  const [storedClaims, setStoredClaims] = useState<StoredClaim[]>([]);
  const [cbaDrafts, setCbaDrafts] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("QUEUE");
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedStoredClaim, setSelectedStoredClaim] = useState<StoredClaim | null>(null);

  const refreshData = async (): Promise<void> => {
    try {
      const [queueRes, claimsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/v1/ehr/queue`),
        fetch(`${API_BASE_URL}/api/v1/hmo/claims`),
      ]);

      if (queueRes.ok) {
        const queueData = await queueRes.json();
        setReviewQueue(Array.isArray(queueData) ? queueData : []);
      }

      if (claimsRes.ok) {
        const claimsData = await claimsRes.json();
        setStoredClaims(Array.isArray(claimsData) ? claimsData : []);
      }
    } catch (error) {
      console.error("Failed to refresh HMO dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!mounted || !isAuthenticated) return;
      setLoading(true);
      await refreshData();
    };

    if (isAuthenticated) {
      run();
      const interval = setInterval(() => {
        if (mounted) refreshData();
      }, 3000);

      return () => {
        mounted = false;
        clearInterval(interval);
      };
    }
  }, [isAuthenticated]);

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedAuditor === "HMO-AUDIT-01" && password === "123") {
      setIsAuthenticated(true);
      setLoginError(false);
    } else {
      setLoginError(true);
      setPassword("");
    }
  };

  const syncClaimToDB = async (claim: QueuedClaim): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claim),
      });
    } catch (e) {
      console.error("Queue sync error", e);
    }
  };

  const postLedgerDecision = async (claim: QueuedClaim, action: "APPROVED" | "REJECTED"): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/audit-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claim.id,
          patient_id: claim.patientId || "PT-1029",
          doctor_name: claim.doctorName,
          procedure_name: claim.testName,
          clinical_indication: claim.clinicalIndication || "",
          ai_score: claim.aiScore,
          status: action,
          resolved_by: claim.resolvedBy || "MediClaim Auditor",
          deducted_amount: claim.deductedAmount || 0,
          paycode: claim.paycode || null,
          total_cost: claim.total_cost || 0,
          hmo_payout: claim.hmo_payout || 0,
          settlement_status: action === "REJECTED" ? "HMO_AUDIT_REJECTED" : (claim.settlement_status || "PENDING_HMO_REVIEW"),
          reasoning: claim.aiReasoning || "",
        }),
      });
    } catch (e) {
      console.error("Audit log write failed", e);
    }
  };

  const handleCbaAction = async (
    id: string,
    action: "APPROVED" | "REJECTED" | "NEEDS_INFO" | "COMMENT",
  ): Promise<void> => {
    const claim = reviewQueue.find((q: QueuedClaim) => q.id === id);
    if (!claim) return;

    const defaultDraft =
      action === "APPROVED"
        ? "Coverage Approved."
        : action === "REJECTED"
          ? "Coverage Denied: does not meet medical necessity or policy requirements."
          : "";

    const draft = (cbaDrafts[id] || defaultDraft).trim();
    if (!draft && action === "COMMENT") return;

    const message: Message = {
      senderRole: "HMO",
      senderName: "MediClaim Auditor",
      text: draft,
      time: new Date().toLocaleTimeString(),
    };

    const nextStatus =
      action === "COMMENT" ? claim.status : action;

    const updatedClaim: QueuedClaim = {
      ...claim,
      status: nextStatus as QueuedClaim["status"],
      resolvedBy: "MediClaim Auditor",
      messages:
        draft.length > 0 ? [...claim.messages, message] : claim.messages,
    };

    setReviewQueue((prev: QueuedClaim[]) => prev.map((q: QueuedClaim) => (q.id === id ? updatedClaim : q)));
    await syncClaimToDB(updatedClaim);

    if (action === "APPROVED" || action === "REJECTED") {
      await postLedgerDecision(updatedClaim, action);
    }

    setCbaDrafts((prev: Record<string, string>) => ({ ...prev, [id]: "" }));
    await refreshData();
  };

  const pendingClaims = useMemo(
    () =>
      reviewQueue.filter(
        (q: QueuedClaim) =>
          !q.isArchived &&
          (q.status === "PENDING" || q.status === "NEEDS_INFO") &&
          (q.settlement_status || "PENDING_HMO_REVIEW") === "PENDING_HMO_REVIEW",
      ),
    [reviewQueue],
  );

  const pendingLiability = pendingClaims.reduce(
    (acc: number, curr: QueuedClaim) => acc + (curr.hmo_payout || 0),
    0,
  );

  const formatNaira = (amount: number) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 2,
    }).format(amount || 0);

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-10 rounded-3xl shadow-2xl">
          <div className="w-16 h-16 bg-indigo-600 rounded-full mx-auto mb-6 flex items-center justify-center">
            <span className="text-white text-2xl font-black">MC</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mb-2 text-center">
            MediClaim Insurance
          </h1>
          <p className="text-sm text-slate-400 mb-8 text-center">
            Authenticate to access the Medical Auditor Dashboard.
          </p>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Auditor Identity
              </label>
              <select
                value={selectedAuditor}
                onChange={(e) => setSelectedAuditor(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-white outline-none focus:border-indigo-500 font-bold"
              >
                <option value="HMO-AUDIT-01">HMO-AUDIT-01 (Lead Medical Auditor)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Secure PIN
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="PIN (123)"
                className={`w-full p-4 rounded-xl bg-slate-800 border text-white outline-none focus:border-indigo-500 tracking-widest ${
                  loginError ? "border-rose-500" : "border-slate-700"
                }`}
              />
              {loginError && (
                <p className="text-rose-500 text-xs mt-2 font-bold">
                  Invalid Authorization PIN.
                </p>
              )}
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition-colors mt-4"
            >
              Access Terminal
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 font-sans pb-12 relative flex flex-col">
      {selectedStoredClaim && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Stored HMO Claim Record</p>
                <h2 className="text-xl font-black text-slate-800 tracking-tight">{selectedStoredClaim.procedure_name}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {selectedStoredClaim.patient_id} • {selectedStoredClaim.doctor_name} • {selectedStoredClaim.updated_at ? new Date(selectedStoredClaim.updated_at).toLocaleString() : "No timestamp"}
                </p>
              </div>
              <button
                onClick={() => setSelectedStoredClaim(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black"
              >
                Close
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">AI Score</p>
                  <p className="text-2xl font-black text-slate-800">{Math.round((selectedStoredClaim.ai_score || 0) * 100)}%</p>
                </div>
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                  <p className="text-sm font-black text-slate-800 wrap-break-word whitespace-normal">{selectedStoredClaim.status}</p>
                </div>
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Settlement</p>
                  <p className="text-sm font-black text-slate-800 break-all whitespace-normal">{selectedStoredClaim.settlement_status || '-'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Resolved By</p>
                  <p className="text-sm font-black text-slate-800 wrap-break-word whitespace-normal">{selectedStoredClaim.resolved_by || '-'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Clinical Notes</p>
                    <p className="text-sm leading-relaxed text-slate-700 italic whitespace-pre-wrap wrap-break-word">{selectedStoredClaim.notes || 'No notes stored.'}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Clinical Indication</p>
                    <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap wrap-break-word">{selectedStoredClaim.clinical_indication || 'No indication stored.'}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">AI Reasoning</p>
                    <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap wrap-break-word">{selectedStoredClaim.ai_reasoning || selectedStoredClaim.reasoning || 'No reasoning stored.'}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Financial Snapshot</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Total Cost</span><strong className="text-slate-800">{formatNaira(selectedStoredClaim.total_cost || 0)}</strong></div>
                      <div className="flex justify-between"><span className="text-slate-500">HMO Payout</span><strong className="text-indigo-600">{formatNaira(selectedStoredClaim.hmo_payout || 0)}</strong></div>
                      <div className="flex justify-between"><span className="text-slate-500">Patient Deducted</span><strong className="text-emerald-600">{formatNaira(selectedStoredClaim.deducted_amount || 0)}</strong></div>
                      <div className="flex justify-between"><span className="text-slate-500">Paycode</span><strong className="text-slate-800 break-all text-right">{selectedStoredClaim.paycode || '-'}</strong></div>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Debugger & Suggestions</p>
                    {selectedStoredClaim.suggestions && selectedStoredClaim.suggestions.length > 0 ? (
                      <ul className="list-disc pl-5 space-y-2">
                        {selectedStoredClaim.suggestions.map((sug: string, i: number) => (
                          <li key={i} className="text-sm text-slate-700">{sug}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500 italic">No suggestions stored.</p>
                    )}
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Communication Log</p>
                    {selectedStoredClaim.messages && selectedStoredClaim.messages.length > 0 ? (
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {selectedStoredClaim.messages.map((msg: Message, idx: number) => (
                          <div key={idx} className={`p-3 rounded-xl text-sm border ${msg.senderRole === 'HMO' ? 'bg-indigo-50 border-indigo-100 text-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                            <p className="text-[9px] font-black opacity-60 uppercase tracking-wider mb-1">{msg.senderName} • {msg.time}</p>
                            {msg.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 italic">No communication log stored.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="w-full bg-slate-900 text-white p-3 flex justify-between items-center px-6 shadow-md z-40 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-indigo-400 animate-pulse" />
          <span className="font-black tracking-tight text-lg text-slate-100 hidden md:block">
            MediClaim <span className="font-medium text-slate-400">Insurance CBA</span>
          </span>
        </div>
        <div className="flex items-center gap-4 bg-slate-800 rounded-lg p-1.5 border border-slate-700 pr-4">
          <div className="text-white w-8 h-8 rounded-md flex items-center justify-center font-bold text-[10px] uppercase bg-indigo-600">
            HMO
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-bold leading-none">{selectedAuditor}</span>
            <span className="text-[9px] text-slate-400 uppercase">Medical Audit</span>
          </div>
          <div className="h-6 w-px bg-slate-600 mx-2" />
          <button
            onClick={() => {
              setIsAuthenticated(false);
              setPassword("");
            }}
            className="text-[10px] uppercase tracking-widest font-black text-rose-400 hover:text-rose-300"
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 md:p-8 flex-1 w-full">
        <div className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tight">
              Medical Audit Workspace
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              Manual review queue plus persisted HMO claim history.
            </p>
          </div>
          <div className="text-left md:text-right bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              Pending Payout Liability
            </span>
            <p className="text-2xl font-black text-indigo-600">
              {formatNaira(pendingLiability)}
            </p>
          </div>
        </div>

        <div className="flex bg-slate-200/50 p-1 rounded-xl w-fit mb-6">
          <button
            onClick={() => setActiveTab("QUEUE")}
            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
              activeTab === "QUEUE"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Manual Review Queue
          </button>
          <button
            onClick={() => setActiveTab("HISTORY")}
            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
              activeTab === "HISTORY"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Stored HMO Claims
          </button>
        </div>

        {activeTab === "QUEUE" ? (
          loading ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300 shadow-sm">
              <p className="text-slate-500 font-bold">Loading queue…</p>
            </div>
          ) : pendingClaims.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300 shadow-sm flex flex-col items-center justify-center min-h-[40vh]">
              <div className="w-16 h-16 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center text-3xl mb-4">
                ✓
              </div>
              <p className="text-slate-500 font-black uppercase tracking-widest text-sm">
                Inbox Zero
              </p>
              <p className="text-xs text-slate-400 mt-2 font-medium">
                No pending claims require manual authorization.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {pendingClaims.map((claim: QueuedClaim) => {
                const totalCost = claim.total_cost || 0;
                const hmoCovered = claim.hmo_payout || 0;
                const patientOwes = Math.max(totalCost - hmoCovered, 0);

                return (
                  <div
                    key={claim.id}
                    className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden flex flex-col md:flex-row min-h-125"
                  >
                    <div className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/50">
                      <div className="p-6 md:p-8 flex-1 flex flex-col">
                        <div className="flex justify-between items-start mb-6 shrink-0">
                          <div>
                            <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded uppercase tracking-widest border border-indigo-100 shadow-sm">
                              Provider Request
                            </span>
                            <h2 className="text-xl font-black text-slate-800 mt-3 tracking-tight">
                              {claim.testName}
                            </h2>
                            <p className="text-xs text-slate-500 mt-1">
                              Requested by{" "}
                              <strong className="text-slate-700">{claim.doctorName}</strong>
                              {" "}• {claim.patientId || "Unknown patient"}
                            </p>
                          </div>
                        </div>

                        <div className="bg-white p-5 rounded-xl border border-slate-200 text-sm italic text-slate-700 leading-relaxed shadow-sm shrink-0 relative">
                          <div className="absolute -top-3 left-4 bg-white px-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            Clinical Notes
                          </div>
                          &ldquo;{claim.notes}&rdquo;
                        </div>

                        {claim.messages.length > 0 && (
                          <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col flex-1 min-h-0">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 shrink-0">
                              Provider Communication
                            </p>
                            <div className="overflow-y-auto pr-3 flex flex-col gap-3 flex-1">
                              {claim.messages.map((msg: Message, idx: number) => (
                                <div
                                  key={idx}
                                  className={`p-4 rounded-xl text-sm shadow-sm ${
                                    msg.senderRole === "HMO"
                                      ? "bg-indigo-50 border border-indigo-100 text-indigo-900 ml-8"
                                      : "bg-white border border-slate-200 text-slate-800 mr-8"
                                  }`}
                                >
                                  <span className="text-[9px] font-black block opacity-50 mb-1.5 uppercase tracking-wider">
                                    {msg.senderName} • {msg.time}
                                  </span>
                                  {msg.text}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="w-full md:w-1/2 flex flex-col bg-white">
                      <div className="p-6 md:p-8 flex-1 flex flex-col space-y-6">
                        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm shrink-0">
                          <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-200">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                              Policy Verification
                            </span>
                            <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-1 rounded shadow-sm border border-slate-200">
                              {claim.patientId || "PT-1029"}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-xs">
                            <div>
                              <span className="text-slate-500 block mb-1">Claim Total Cost</span>
                              <strong className="text-slate-800 text-sm">{formatNaira(totalCost)}</strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block mb-1 text-[9px] uppercase font-bold tracking-widest">
                                HMO Covered Limit
                              </span>
                              <strong className="text-indigo-600 text-sm">{formatNaira(hmoCovered)}</strong>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-500 block mb-1 text-[9px] uppercase font-bold tracking-widest">
                                Patient Out-of-Pocket
                              </span>
                              <strong className="text-emerald-600 text-sm">{formatNaira(patientOwes)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-1 flex flex-col">
                          <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 shrink-0">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                              AI Adjudication Log
                            </span>
                            <div className="flex flex-col items-end">
                              <span
                                className={`text-2xl font-black leading-none ${
                                  claim.aiScore >= 0.9
                                    ? "text-emerald-500"
                                    : claim.aiScore >= 0.75
                                      ? "text-amber-500"
                                      : "text-rose-500"
                                }`}
                              >
                                {Math.round(claim.aiScore * 100)}%
                              </span>
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                Confidence
                              </span>
                            </div>
                          </div>

                          <div className="space-y-4 overflow-y-auto pr-2 flex-1 min-h-0">
                            <div>
                              <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1.5 pl-1">
                                Dual-Matrix Reasoning
                              </p>
                              <p className="text-[11px] text-slate-700 leading-relaxed bg-indigo-50/50 p-3.5 rounded-lg border border-indigo-100 shadow-inner font-mono">
                                {claim.aiReasoning}
                              </p>
                            </div>

                            <div>
                              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1.5 pl-1">
                                Debugger & Suggestions
                              </p>
                              {claim.suggestions && claim.suggestions.length > 0 ? (
                                <ul className="list-disc pl-5 space-y-1.5 bg-amber-50 p-3.5 rounded-lg border border-amber-200 shadow-sm">
                                  {claim.suggestions.map((sug: string, i: number) => (
                                    <li key={i} className="text-[11px] text-amber-900 font-medium leading-relaxed">
                                      {sug}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-[10px] text-slate-500 italic shadow-sm text-center">
                                  AI found no explicit improvement suggestions.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 md:p-8 border-t border-slate-200 bg-slate-50 shrink-0">
                        <textarea
                          value={cbaDrafts[claim.id] || ""}
                          onChange={(e) =>
                            setCbaDrafts((prev: Record<string, string>) => ({ ...prev, [claim.id]: e.target.value }))
                          }
                          placeholder="Type query to hospital or rejection reason..."
                          className="w-full p-4 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white mb-4 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 resize-none h-24"
                        />
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleCbaAction(claim.id, "NEEDS_INFO")}
                            disabled={!cbaDrafts[claim.id]}
                            className="flex-1 bg-white border border-amber-300 text-amber-700 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-amber-50 disabled:opacity-50 transition-colors shadow-sm"
                          >
                            💬 Query
                          </button>
                          <button
                            onClick={() => handleCbaAction(claim.id, "REJECTED")}
                            className="flex-1 bg-white border border-rose-300 text-rose-700 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-rose-50 shadow-sm transition-colors"
                          >
                            ❌ Deny
                          </button>
                          <button
                            onClick={() => handleCbaAction(claim.id, "APPROVED")}
                            className="flex-[1.5] bg-indigo-600 text-white px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-indigo-700 shadow-md transition-colors"
                          >
                            ✅ Authorize
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h2 className="text-lg font-black text-slate-800 tracking-tight">
                Persisted HMO Claim Ledger
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                These are claims already stored on the backend via the HMO claim history endpoint.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-275 text-left">
                <thead>
                  <tr className="bg-white text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="p-4">Claim ID</th>
                    <th className="p-4">Patient</th>
                    <th className="p-4">Procedure</th>
                    <th className="p-4">Doctor</th>
                    <th className="p-4">AI Score</th>
                    <th className="p-4">HMO Payout</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Resolved By</th>
                    <th className="p-4">When</th>
                    <th className="p-4 pr-6 text-right">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {storedClaims.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-10 text-center text-slate-400 font-bold italic">
                        No stored HMO claims yet.
                      </td>
                    </tr>
                  ) : (
                    storedClaims.map((claim: StoredClaim) => (
                      <tr key={claim.claim_id} className="hover:bg-slate-50">
                        <td className="p-4 font-mono text-xs text-slate-700">{claim.claim_id}</td>
                        <td className="p-4 text-sm font-bold text-slate-700">{claim.patient_id}</td>
                        <td className="p-4 text-sm text-slate-800">{claim.procedure_name}</td>
                        <td className="p-4 text-sm text-slate-600">{claim.doctor_name}</td>
                        <td className="p-4 text-sm font-black text-slate-800">
                          {Math.round((claim.ai_score || 0) * 100)}%
                        </td>
                        <td className="p-4 text-sm font-bold text-indigo-600">
                          {formatNaira(claim.hmo_payout)}
                        </td>
                        <td className="p-4">
                          <span className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border bg-slate-50 text-slate-700 border-slate-200">
                            {claim.status}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-slate-600">{claim.resolved_by || "-"}</td>
                        <td className="p-4 text-sm text-slate-500">
                          {(claim.updated_at || claim.timestamp) ? new Date((claim.updated_at || claim.timestamp) as string).toLocaleString() : "-"}
                        </td>
                        <td className="p-4 pr-6 text-right">
                          <button
                            onClick={() => setSelectedStoredClaim(claim)}
                            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
