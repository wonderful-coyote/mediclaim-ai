"use client";
import { useState, useEffect } from "react";

// --- THE MASTER API SWITCH ---
const API_BASE_URL = "https://wonderfulcoyote-mediclaim-ai.hf.space";

// --- Types ---
interface Doctor {
  id: string;
  name: string;
  rank: "HO" | "MO" | "JR" | "SR" | "Cons";
  dept: string;
}

interface AuditResult {
  status: "AUTHORIZED" | "PARTIAL_PAYMENT" | "FINANCE_REFERRAL" | "REJECTED";
  audit_score: number;
  payout_tier: string;
  deducted: number;
  remaining: number;
  new_wallet_balance: number;
  new_balance?: number;
  message: string;
  paycode?: string;
  reasoning?: string;
  clinical_indication?: string;
  suggestions?: string[];
  // 🆕 NEW CFO DATA FIELDS
  total_cost?: number;
  hmo_payout?: number;
  settlement_status?: string;
}

interface Investigation {
  id: string;
  name: string;
  dept: string;
  cost: number;
  copay: number;
  category: string;
}

interface Message {
  senderRole: "HO" | "Consultant";
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
  reviewerIds: string[];
  reviewerNames: string[];
  resolvedBy?: string;
  deductedAmount: number;
  paycode?: string;
  clinicalIndication?: string;
  payout_tier?: string;
  suggestions?: string[];
  // 🆕 NEW CFO DATA FIELDS
  total_cost?: number;
  hmo_payout?: number;
  settlement_status?: string;
}

interface ReceiptData {
  hospitalName: string;
  patientName: string;
  patientId: string;
  procedure: string;
  department: string;
  date: string;
  reference: string;
  amountDeducted: number;
  hmoAmount: number;
  patientCopay: number;
  totalCost: number;
  paycode?: string;
  resolvedBy: string;
}

const staffDirectory: Doctor[] = [
  { id: "DOC-001", name: "Dr. Kunle Ade", rank: "Cons", dept: "Radiology" },
  { id: "DOC-002", name: "Dr. Amaka V.", rank: "Cons", dept: "Internal Med" },
  { id: "DOC-003", name: "Dr. Sarah J.", rank: "SR", dept: "Radiology" },
  { id: "DOC-004", name: "Dr. Chidi Oke", rank: "MO", dept: "Surgery" },
  { id: "DOC-005", name: "Dr. Ogooluwa Isaac", rank: "HO", dept: "Radiology" },
];

export default function EHRTerminal() {
  const [isMounted, setIsMounted] = useState(false);

  const [currentDoc, setCurrentDoc] = useState<Doctor | null>(null);
  const [loginUserId, setLoginUserId] = useState(staffDirectory[4].id);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(false);

  const [reviewQueue, setReviewQueue] = useState<QueuedClaim[]>([]);
  const [patientId] = useState("PT-1029");
  const [balance, setBalance] = useState(50000);

  const [appMode, setAppMode] = useState<"ORDER" | "REVIEW">("ORDER");
  const [status, setStatus] = useState("System Ready");
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedReviewers, setSelectedReviewers] = useState<Doctor[]>([]);
  const [testList, setTestList] = useState<Investigation[]>([]);
  const [selectedTest, setSelectedTest] = useState<Investigation | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);

  const [hoReplyText, setHoReplyText] = useState("");
  const [consultantDrafts, setConsultantDrafts] = useState<Record<string, string>>({});

  const [loadedClaimId, setLoadedClaimId] = useState<string | null>(null);

  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [isEmailing, setIsEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const activeClaim = currentDoc
    ? reviewQueue.slice().reverse().find((q) => q.doctorName === currentDoc.name && q.status !== "DISPATCHED")
    : null;

  const myConsultantQueue = currentDoc
    ? reviewQueue.filter((q) => q.reviewerIds.includes(currentDoc.id))
    : [];

  const hoNotificationCount = reviewQueue.filter(
    (q) => q.doctorName === currentDoc?.name && ["NEEDS_INFO", "APPROVED", "REJECTED"].includes(q.status)
  ).length;

  const hasComplaint = /(presenting\s*complaint|complaint|\bc\/?o\b|\bhpi\b|history|symptom|\bp\/?c\b|\bhpc\b)/i.test(clinicalNotes);
  const hasDiagnosis = /(diagnos[ei]s|\bdx\b|differential|\bddx\b|assessment|assess|\bimp\b|impression)/i.test(clinicalNotes);
  const isNotesValid = clinicalNotes.trim().length >= 10 && hasComplaint && hasDiagnosis;

  useEffect(() => {
    const fetchRealBalance = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/patient/${patientId}`);
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance);
        }
      } catch {}
    };
    fetchRealBalance(); 
    const interval = setInterval(fetchRealBalance, 3000); 
    return () => clearInterval(interval);
  }, [patientId]);

  useEffect(() => {
    setIsMounted(true);
    const fetchQueue = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/ehr/queue`);
        if (res.ok) {
          const data = await res.json();
          setReviewQueue(data);
          setIsReviewing(false);
        }
      } catch (e) { console.error("Queue sync error", e); }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  const syncClaimToDB = async (claim: QueuedClaim) => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claim),
      });
    } catch (e) { console.error("Sync error", e); }
  };

  const deleteClaimFromDB = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/queue/${id}`, { method: "DELETE" });
    } catch (e) { console.error("Delete error", e); }
  };

  useEffect(() => {
    if (activeClaim && activeClaim.id !== loadedClaimId) {
      setClinicalNotes(activeClaim.notes);
      if (testList.length > 0) {
        const foundTest = testList.find((t) => t.name === activeClaim.testName);
        if (foundTest) setSelectedTest(foundTest);
      }
      setLoadedClaimId(activeClaim.id);
    }
  }, [activeClaim, loadedClaimId, testList]);

  // 🆕 UPDATED: Now accepts and sends the CFO financial fields to the backend
  const saveToDatabase = async (
    claimId: string,
    docName: string,
    testName: string,
    score: number,
    finalStatus: string,
    resolver: string,
    deducted: number = 0,
    paycode?: string,
    clinicalIndication: string = "", 
    totalCost: number = 50000,
    hmoPayout: number = 40000,
    settlementStatus: string = "PENDING_AI_AUDIT"
  ) => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/audit-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          patient_id: patientId,
          doctor_name: docName,
          procedure_name: testName,
          clinical_indication: clinicalIndication,
          ai_score: score,
          status: finalStatus,
          resolved_by: resolver,
          deducted_amount: deducted,
          paycode: paycode || null,
          // 🆕 Sending the CFO data
          total_cost: totalCost,
          hmo_payout: hmoPayout,
          settlement_status: settlementStatus
        }),
      });
    } catch (e) { console.error("Failed to save to DB:", e); }
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/clinical/dictionary`)
      .then((res) => res.json())
      .then((data) => {
        setTestList(data);
        if (data.length > 0 && !activeClaim) setSelectedTest(data[0]);
      })
      .catch((err) => console.error("Failed to fetch dictionary", err));
  }, [activeClaim]);

  const getRequiredCount = () =>
    currentDoc && ["HO", "MO", "JR"].includes(currentDoc.rank) ? 2 : 1;

  const toggleReviewer = (doc: Doctor) => {
    if (selectedReviewers.find((r) => r.id === doc.id)) {
      setSelectedReviewers(selectedReviewers.filter((r) => r.id !== doc.id));
    } else if (selectedReviewers.length < getRequiredCount()) {
      setSelectedReviewers([...selectedReviewers, doc]);
    }
  };

  const processOrder = async () => {
    if (auditResult || !selectedTest || !currentDoc || !isNotesValid) return;
    setLoading(true);
    setStatus("Syncing Ledger...");

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/ehr/order-procedure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim_id: "ORD-" + Date.now(),
            initiator_rank: currentDoc.rank,
            clinical_notes: clinicalNotes,
            procedure_id: selectedTest.id,
            procedure_name: selectedTest.name,
            patient: {
              id: patientId,
              name: "Ogooluwa Isaac",
              gender: "Male",
              virtual_account: "9920102933",
              wallet_balance: Number(balance),
            },
            hospital_id: "HOSP-01",
            amount: selectedTest.cost,
          }),
        }
      );

      if (!response.ok) throw new Error("Server Error");
      const data: AuditResult = await response.json();

      if (data) {
        setAuditResult(data);
        setStatus("COMPLETED");
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setStatus("OFFLINE: Check Connection");
    } finally { setLoading(false); }
  };

  const handleReviewSubmit = () => {
    if (!currentDoc) return;
    setIsReviewing(true);
    const newTicket: QueuedClaim = {
      id: "REQ-" + Math.floor(Math.random() * 10000),
      doctorName: currentDoc.name,
      testName: selectedTest?.name || "Unknown",
      notes: clinicalNotes,
      aiScore: auditResult?.audit_score || 0,
      aiReasoning: auditResult?.reasoning || "No reasoning provided.",
      status: "PENDING",
      messages: [],
      reviewerIds: selectedReviewers.map((r) => r.id),
      reviewerNames: selectedReviewers.map((r) => r.name),
      deductedAmount: auditResult?.deducted || 0,
      paycode: auditResult?.paycode,
      clinicalIndication: auditResult?.clinical_indication || "",
      payout_tier: auditResult?.payout_tier,
      suggestions: auditResult?.suggestions || [],
      // 🆕 Save CFO Data into the Queue!
      total_cost: auditResult?.total_cost || selectedTest?.cost || 50000,
      hmo_payout: auditResult?.hmo_payout || ((selectedTest?.cost || 50000) * 0.8),
      settlement_status: auditResult?.settlement_status || "PENDING_CONSULTANT"
    };
    
    setReviewQueue((prev) => [...prev, newTicket]);
    syncClaimToDB(newTicket);

    saveToDatabase(
      newTicket.id, 
      newTicket.doctorName, 
      newTicket.testName, 
      newTicket.aiScore,
      "PENDING", 
      "Pending Review", 
      newTicket.deductedAmount, 
      newTicket.paycode,
      newTicket.clinicalIndication || "", 
      newTicket.total_cost, 
      newTicket.hmo_payout, 
      newTicket.settlement_status
    );

    setTimeout(() => { window.open("/", "_blank"); }, 300);
  };

  const resubmitOrderWithUpdates = async () => {
    if (!activeClaim || !selectedTest || !currentDoc || !isNotesValid) return;
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/ehr/order-procedure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim_id: activeClaim.id,
            initiator_rank: currentDoc.rank,
            clinical_notes: clinicalNotes,
            procedure_id: selectedTest.id,
            procedure_name: selectedTest.name,
            patient: { id: patientId, name: "Ogooluwa", gender: "M", virtual_account: "0", wallet_balance: Number(balance) },
            hospital_id: "HOSP-01",
            amount: selectedTest.cost,
          }),
        }
      );

      const data: AuditResult = await response.json();

      if (data) {
        setAuditResult(data);
        const updatedClaim: QueuedClaim = {
          ...activeClaim,
          notes: clinicalNotes,
          aiScore: data.audit_score,
          aiReasoning: data.reasoning || "Updated reasoning",
          deductedAmount: data.deducted || 0,
          paycode: data.paycode,
          clinicalIndication: data.clinical_indication || "",
          payout_tier: data.payout_tier,
          suggestions: data.suggestions || [],
          // 🆕 Update CFO fields on resubmit
          total_cost: data.total_cost,
          hmo_payout: data.hmo_payout,
          settlement_status: data.settlement_status,
          status: "PENDING" as const, 
          messages: [
            ...activeClaim.messages,
            { senderRole: "HO" as const, senderName: currentDoc.name, text: hoReplyText, time: new Date().toLocaleTimeString() },
          ],
        };

        setReviewQueue((prev) => prev.map((q) => q.id === activeClaim.id ? updatedClaim : q));
        syncClaimToDB(updatedClaim);
        setHoReplyText("");
      }
    } catch (e) { console.error("Fetch Error:", e); } finally { setLoading(false); }
  };

  const handleFinalDispatch = () => {
    const finalAmountToDeduct = auditResult?.deducted ?? activeClaim?.deductedAmount ?? 0;
    const finalPaycode = auditResult?.paycode ?? activeClaim?.paycode;

    if (finalAmountToDeduct > 0) {
      setBalance((prev) => prev - finalAmountToDeduct);
    }

    const procedureName = selectedTest?.name || activeClaim?.testName || "Medical Procedure";
    const dept = selectedTest?.dept || "General";
    const procedureCost = selectedTest?.cost || 0;
    const copayAmount = Math.round(procedureCost * 0.2);
    const hmoAmount = procedureCost - copayAmount;

    if (activeClaim) {
      const updatedClaim: QueuedClaim = { ...activeClaim, status: "DISPATCHED" as const };
      setReviewQueue((prev) => prev.map((q) => q.id === activeClaim.id ? updatedClaim : q));
      syncClaimToDB(updatedClaim);
      
      // If it was Peer Review Approved, force settlement to SETTLED
      const finalSettlementStatus = activeClaim.status === "APPROVED" ? "SETTLED" : (activeClaim.settlement_status || "PENDING_AI_AUDIT");
      
      saveToDatabase(
        activeClaim.id, activeClaim.doctorName, activeClaim.testName, activeClaim.aiScore,
        "DISPATCHED", activeClaim.resolvedBy || "Peer Review", finalAmountToDeduct, finalPaycode,
        activeClaim.clinicalIndication || "", activeClaim.total_cost, activeClaim.hmo_payout, finalSettlementStatus
      );
    } else if (auditResult && selectedTest && currentDoc) {
      saveToDatabase(
        "ORD-" + Date.now(), currentDoc.name, selectedTest.name, auditResult.audit_score,
        "DISPATCHED", "AI Auto-Approved", finalAmountToDeduct, finalPaycode,
        auditResult.clinical_indication || "", auditResult.total_cost, auditResult.hmo_payout, auditResult.settlement_status
      );
    }

    setReceiptData({
      hospitalName: "MediClaim Hospital", patientName: "Ogooluwa Isaac", patientId: patientId,
      procedure: procedureName, department: dept, date: new Date().toLocaleString(),
      reference: `REF-${Math.floor(Math.random() * 1000000)}`, amountDeducted: finalAmountToDeduct,
      hmoAmount: hmoAmount, patientCopay: copayAmount, totalCost: procedureCost,
      paycode: finalPaycode, resolvedBy: activeClaim?.resolvedBy || "AI Auto-Approved",
    });
    setEmailSent(false);
  };

  const closeReceiptAndReset = () => {
    setReceiptData(null);
    setAuditResult(null);
    setStatus("System Ready");
    setSelectedReviewers([]);
    setClinicalNotes("");
    setIsReviewing(false);
    setHoReplyText("");
    setLoadedClaimId(null);
  };

  const handleEmailReceipt = () => {
    setIsEmailing(true);
    setTimeout(() => { setIsEmailing(false); setEmailSent(true); }, 1500);
  };

  const handleConsultantAction = (id: string, action: "APPROVED" | "REJECTED" | "NEEDS_INFO" | "COMMENT") => {
    if (!currentDoc) return;
    const claim = reviewQueue.find((q) => q.id === id);
    if (!claim) return;

    const draft = consultantDrafts[id] || (action === "APPROVED" ? "Authorized." : action === "REJECTED" ? "Rejected." : "");
    if (!draft && action === "COMMENT") return;

    const newMessage: Message = { senderRole: "Consultant" as const, senderName: currentDoc.name, text: draft, time: new Date().toLocaleTimeString() };

    if (action === "COMMENT" || action === "NEEDS_INFO") {
      const newStatus = action === "NEEDS_INFO" ? ("NEEDS_INFO" as const) : undefined;
      const updatedClaim: QueuedClaim = { ...claim, ...(newStatus && { status: newStatus }), messages: [...claim.messages, newMessage] };
      setReviewQueue((prev) => prev.map((q) => q.id === id ? updatedClaim : q));
      syncClaimToDB(updatedClaim);
    } else {
      const updatedClaim: QueuedClaim = { ...claim, status: action as "APPROVED" | "REJECTED", resolvedBy: currentDoc.name, messages: draft ? [...claim.messages, newMessage] : claim.messages };
      setReviewQueue((prev) => prev.map((q) => q.id === id ? updatedClaim : q));
      syncClaimToDB(updatedClaim);

      if (action === "REJECTED") {
        saveToDatabase(
          updatedClaim.id, updatedClaim.doctorName, updatedClaim.testName, updatedClaim.aiScore,
          "REJECTED", currentDoc.name, 0, undefined, updatedClaim.clinicalIndication || "",
          updatedClaim.total_cost, updatedClaim.hmo_payout, "HMO_AUDIT_REJECTED"
        );
      }
    }
    setConsultantDrafts({ ...consultantDrafts, [id]: "" });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPassword === "123") {
      const doc = staffDirectory.find((d) => d.id === loginUserId);
      if (doc) { setCurrentDoc(doc); setAppMode(doc.rank === "Cons" ? "REVIEW" : "ORDER"); }
      setLoginError(false);
      setLoadedClaimId(null);
    } else { setLoginError(true); }
  };

  if (!isMounted) return null;

  const displayHoldAmount = auditResult?.deducted ?? activeClaim?.deductedAmount ?? 0;

  if (!currentDoc) {
    return (
      <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-10 rounded-3xl shadow-2xl">
          <div className="w-16 h-16 bg-blue-600 rounded-full mx-auto mb-6 flex items-center justify-center">
            <span className="text-white text-2xl font-black">M</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mb-2 text-center">MediClaim Access</h1>
          <p className="text-sm text-slate-400 mb-8 text-center">Authenticate into the OpenMRS & Interswitch Secure Network.</p>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Practitioner Identity</label>
              <select value={loginUserId} onChange={(e) => setLoginUserId(e.target.value)} className="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-white outline-none focus:border-blue-500 font-bold">
                {staffDirectory.map((doc) => <option key={doc.id} value={doc.id}>{doc.name} ({doc.rank} - {doc.dept})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Network Password</label>
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Enter password (123)" className={`w-full p-4 rounded-xl bg-slate-800 border text-white outline-none focus:border-blue-500 ${loginError ? "border-rose-500" : "border-slate-700"}`} />
              {loginError && <p className="text-rose-500 text-xs mt-2 font-bold">Incorrect password. Hint: Use 123.</p>}
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-blue-700 transition-colors mt-4">Secure Login</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col relative">
      {receiptData && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="bg-slate-900 text-white p-6 text-center relative border-b-4 border-blue-500">
              <div className="w-12 h-12 bg-white text-slate-900 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
              <h2 className="text-xl font-black tracking-tight mb-1">Payment Successful</h2>
              <p className="text-slate-400 text-xs uppercase tracking-widest font-bold">Interswitch Virtual Wallet</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Hospital</p><p className="text-sm font-bold text-slate-800">{receiptData.hospitalName}</p></div>
                <div className="text-right"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Reference</p><p className="text-xs font-mono text-slate-800 bg-slate-100 px-2 py-1 rounded">{receiptData.reference}</p></div>
              </div>
              <div className="space-y-3 border-b border-slate-100 pb-4">
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Date</span><span className="text-xs font-bold text-slate-800">{receiptData.date}</span></div>
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Patient</span><span className="text-xs font-bold text-slate-800">{receiptData.patientName} ({receiptData.patientId})</span></div>
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Procedure</span><span className="text-xs font-bold text-slate-800 text-right">{receiptData.procedure} <br /><span className="text-[10px] text-slate-400">({receiptData.department})</span></span></div>
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Authorized By</span><span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">{receiptData.resolvedBy}</span></div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Procedure Cost</span><span className="text-sm font-black text-slate-800">₦{receiptData.totalCost.toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-xs font-bold text-slate-500">HMO Coverage (80%)</span></div><span className="text-xs font-black text-blue-600">₦{receiptData.hmoAmount.toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-xs font-bold text-slate-500">Patient Co-pay (20%)</span></div><span className="text-xs font-black text-amber-600">₦{receiptData.patientCopay.toLocaleString()}</span></div>
                <div className="border-t border-slate-200 pt-2">
                  <div className="flex justify-between items-center"><span className="text-xs font-black text-slate-600 uppercase">Charged to Smart Card</span><span className="text-lg font-black text-emerald-600">₦{receiptData.amountDeducted.toLocaleString()}</span></div>
                  {receiptData.amountDeducted < receiptData.patientCopay && <div className="flex justify-between items-center mt-1"><span className="text-xs font-bold text-rose-500">Outstanding Balance</span><span className="text-sm font-black text-rose-600">₦{(receiptData.patientCopay - receiptData.amountDeducted).toLocaleString()}</span></div>}
                </div>
                {receiptData.paycode && (
                  <div className="mt-1 pt-3 border-t border-dashed border-rose-200 bg-rose-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-xl">
                    <div className="flex justify-between items-start">
                      <div><span className="text-[10px] font-black text-rose-600 uppercase tracking-widest block mb-1">Balance Due — Patient Paycode</span><span className="text-base font-mono font-black tracking-widest text-slate-800 bg-white px-3 py-1.5 rounded-lg border border-rose-200 shadow-sm">{receiptData.paycode}</span></div>
                      <div className="text-right mt-1"><span className="text-[10px] text-slate-500 block">Amount Due</span><span className="text-sm font-black text-rose-600">₦{(receiptData.patientCopay - receiptData.amountDeducted).toLocaleString()}</span></div>
                    </div>
                    <p className="text-[10px] text-rose-400 font-bold mt-2">Direct patient to Cashier or POS terminal with this code.</p>
                  </div>
                )}
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-200 space-y-3">
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold text-xs uppercase tracking-wide hover:bg-slate-100 transition-colors shadow-sm">🖨️ Print</button>
                <button onClick={handleEmailReceipt} disabled={isEmailing || emailSent} className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-colors shadow-sm ${emailSent ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"}`}>
                  {isEmailing ? "Sending..." : emailSent ? "✓ Sent to Patient" : "✉️ Email Receipt"}
                </button>
              </div>
              <button onClick={closeReceiptAndReset} className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-black transition-colors shadow-md">Done & Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full bg-slate-900 text-white p-3 flex justify-between items-center px-6 shadow-md z-40 relative">
        <div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" /><span className="font-black tracking-widest text-xs uppercase text-slate-300 hidden md:block">MediClaim Network</span></div>
        <div className="flex items-center gap-4 bg-slate-800 rounded-lg p-1.5 border border-slate-700 pr-4">
          <div className={`text-white w-8 h-8 rounded-md flex items-center justify-center font-bold text-[10px] uppercase ${currentDoc.rank === "Cons" ? "bg-amber-600" : "bg-blue-600"}`}>{currentDoc.rank}</div>
          <div className="hidden sm:flex flex-col"><span className="text-xs font-bold leading-none">{currentDoc.name}</span><span className="text-[9px] text-slate-400 uppercase">{currentDoc.dept} Dept</span></div>
          <div className="h-6 w-px bg-slate-600 mx-2" />
          <button onClick={() => { setCurrentDoc(null); setLoginPassword(""); setClinicalNotes(""); setLoadedClaimId(null); }} className="text-[10px] uppercase tracking-widest font-black text-rose-400 hover:text-rose-300">Log Out</button>
        </div>
      </div>

      {appMode === "ORDER" && currentDoc.rank !== "Cons" && (
        <main className="flex-1 p-6 md:p-12 flex items-center justify-center">
          <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 text-center">Interswitch Smart Card</p>
                <div className="bg-linear-to-br from-slate-800 to-slate-950 p-8 rounded-2xl text-white shadow-xl relative min-h-55 flex flex-col justify-between">
                  <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/10 rounded-full" />
                  <div><p className="text-[10px] opacity-50 uppercase font-bold tracking-wider">Patient ID</p><p className="text-xl font-mono font-bold tracking-tighter">{patientId}</p></div>
                  <div className="space-y-4"><div className="w-full"><p className="text-[10px] opacity-50 uppercase font-bold tracking-wider">Wallet Credit</p><p className="text-2xl sm:text-3xl font-black text-emerald-400 leading-none truncate">₦{(balance ?? 0).toLocaleString()}</p></div></div>
                </div>
              </div>
              {hoNotificationCount > 0 && (
                <div className="bg-amber-100 border border-amber-200 rounded-xl p-4 text-center animate-pulse shadow-sm">
                  <p className="text-amber-800 font-black text-xs uppercase">Action Required</p>
                  <p className="text-amber-700 text-[10px]">Your pending claim has been updated.</p>
                </div>
              )}
            </div>

            <div className="md:col-span-2 bg-white p-10 rounded-3xl shadow-2xl border-t-8 border-blue-600">
              {auditResult && !isReviewing && !["APPROVED", "REJECTED", "NEEDS_INFO", "PENDING"].includes(activeClaim?.status || "") && (
                <button onClick={() => setAuditResult(null)} className="mb-6 flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors">&larr; Back to Edit Notes</button>
              )}

              <h2 className="text-2xl font-black text-slate-800 mb-8 flex justify-between items-center tracking-tight">EHR Clinical Order<span className="text-[9px] bg-slate-100 px-2 py-1 rounded text-slate-500 font-bold uppercase">{status}</span></h2>

              {!auditResult && !activeClaim ? (
                <div className="animate-in fade-in">
                  <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Select Investigation / Procedure</p>
                    <select className="w-full p-3 mb-3 rounded-xl border border-slate-200 bg-white font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500" onChange={(e) => { const found = testList.find((t) => t.id === e.target.value); if (found) setSelectedTest(found); }} value={selectedTest?.id || ""}>
                      {testList.map((test) => (<option key={test.id} value={test.id}>{test.name}</option>))}
                    </select>
                    {selectedTest && (
                      <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-100"><span className="text-xs font-bold text-slate-500">{selectedTest.dept}</span><span className="text-xs text-slate-500">Cost: <strong className="text-slate-800">₦{selectedTest.cost.toLocaleString()}</strong> | Co-pay (20%): ₦{(selectedTest.cost * 0.2).toLocaleString()}</span></div>
                    )}
                  </div>
                  <div className="mb-6">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Clinical Justification (For AI Audit)</label>
                    <textarea value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} placeholder="E.g., Pt presents with P/C of right lower quadrant pain. Dx: Suspected Appendicitis..." className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-25" />
                    {!isNotesValid && clinicalNotes.trim().length > 0 && <p className="text-rose-500 text-[10px] font-bold mt-2">⚠️ Notes must include a Presenting Complaint (e.g., &ldquo;C/O:&rdquo;) AND a Diagnosis/Assessment (e.g., &ldquo;Dx:&rdquo;).</p>}
                  </div>
                  <button onClick={processOrder} disabled={loading || !selectedTest || !isNotesValid} className={`w-full py-4 rounded-2xl font-black text-white transition-all shadow-lg ${!isNotesValid ? "bg-slate-300 cursor-not-allowed" : balance > 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-900 hover:bg-black"}`}>
                    {loading ? "PROCESSING..." : !isNotesValid ? "ENTER P/C & DX TO UNLOCK" : balance > 0 ? "AUTHORIZE & AUDIT" : "AUTHORIZE & AUDIT (WALLET EMPTY)"}
                  </button>
                </div>
              ) : (
                <div className="animate-in slide-in-from-bottom-4">
                  <div className={`p-6 rounded-2xl border-2 mb-4 ${auditResult?.status === "AUTHORIZED" ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100"}`}>
                    <div className="flex justify-between items-center mb-4">
                      <div><h3 className={`text-lg font-black uppercase ${auditResult?.status === "AUTHORIZED" ? "text-emerald-800" : "text-amber-800"}`}>{auditResult?.status?.replace("_", " ") || "REVIEW REQUIRED"}</h3>{selectedTest && (<p className="text-sm font-bold text-slate-500 mt-1">{selectedTest.name}</p>)}</div>
                      <div className="text-right"><p className="text-[10px] font-bold text-slate-400 uppercase">AI Score</p><p className="text-xl font-black">{Math.round((auditResult?.audit_score || activeClaim?.aiScore || 0) * 100)}%</p></div>
                    </div>
                    {(auditResult?.reasoning || activeClaim?.aiReasoning) && (
                      <div className="mb-4 p-3 bg-blue-50/50 rounded-lg border border-blue-100 text-xs text-blue-800 leading-relaxed"><span className="font-black mr-2 tracking-tight">🧠 AI INSIGHT:</span>{auditResult?.reasoning || activeClaim?.aiReasoning}</div>
                    )}
                    <div className="text-[11px] font-bold text-slate-600 uppercase space-y-2 mt-4 border-t border-slate-100 pt-3">
                      <div className="flex justify-between items-center"><span>Pre-Auth Card Hold:</span><span className="text-slate-800">₦{displayHoldAmount.toLocaleString()}</span></div>
                      <div className="flex justify-between items-center border-t border-dashed border-slate-200 pt-2 mt-2">
                        <span className="text-blue-800">HMO Settlement SLA:</span>
                        <span className={`px-3 py-1 rounded-md text-[10px] font-black tracking-widest ${(auditResult?.payout_tier || activeClaim?.payout_tier) === "Instant Payout" ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20" : (auditResult?.payout_tier || activeClaim?.payout_tier) === "72-Hour HMO Audit" ? "bg-rose-500 text-white shadow-md shadow-rose-500/20" : "bg-amber-400 text-amber-950 shadow-md shadow-amber-400/20"}`}>
                          {auditResult?.payout_tier || activeClaim?.payout_tier || "Pending"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {(auditResult?.audit_score || 0) >= 0.9 && auditResult?.status === "AUTHORIZED" ? (
                      <button onClick={handleFinalDispatch} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase shadow-lg hover:bg-emerald-700">DISPATCH TO {selectedTest?.dept?.toUpperCase() || "UNIT"}</button>
                    ) : (
                      <div className="space-y-4">
                        {activeClaim?.status === "PENDING" || isReviewing ? (
                          <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-center animate-in fade-in mt-4 shadow-sm">
                            <div className="w-12 h-12 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4"><span className="font-black text-xl animate-pulse">⏳</span></div>
                            <p className="text-amber-800 font-black text-sm uppercase mb-2">Waiting for Peer Review</p>
                            <p className="text-amber-700 text-xs font-medium mb-2">Paging: <strong className="font-black">{activeClaim?.reviewerNames.join(" & ") || "Consultants"}</strong></p>
                          </div>
                        ) : activeClaim?.status === "APPROVED" ? (
                          <div className="space-y-4 animate-in fade-in">
                            <div className="bg-emerald-100 p-4 rounded-xl border border-emerald-200 text-center">
                              <p className="text-emerald-800 font-black text-sm uppercase mb-1">✅ Peer Review Approved</p>
                              <p className="text-emerald-700 text-xs">Authorized by: <strong>{activeClaim.resolvedBy}</strong></p>
                            </div>
                            <button onClick={handleFinalDispatch} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase shadow-lg hover:bg-emerald-700">DISPATCH & PROCEED</button>
                          </div>
                        ) : activeClaim?.status === "REJECTED" ? (
                          <div className="bg-rose-100 p-4 rounded-xl border border-rose-200 text-center animate-in fade-in">
                            <p className="text-rose-800 font-black text-sm uppercase mb-2">❌ Claim Rejected</p>
                            <p className="text-rose-700 text-xs mb-4">Denied by: <strong>{activeClaim.resolvedBy}</strong>. Funds were not deducted.</p>
                            <button onClick={() => { setReviewQueue((prev) => prev.filter((q) => q.id !== activeClaim.id)); deleteClaimFromDB(activeClaim.id); setAuditResult(null); setLoadedClaimId(null); setClinicalNotes(""); }} className="w-full bg-white text-rose-700 py-3 rounded-xl font-bold text-sm hover:bg-rose-50 border border-rose-200">&larr; Acknowledge & Start Over</button>
                          </div>
                        ) : activeClaim?.status === "NEEDS_INFO" ? (
                          <div className="space-y-4 animate-in fade-in">
                            <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-sm">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Update Clinical Notes (AI Will Re-Grade)</p>
                              <textarea value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} className="w-full p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all min-h-25" />
                            </div>
                            <div className="border border-blue-200 bg-blue-50 rounded-2xl flex flex-col overflow-hidden shadow-sm">
                              <div className="bg-blue-100/50 border-b border-blue-200 p-3 px-4"><p className="text-[10px] font-black text-blue-800 uppercase tracking-widest flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span></span>Chat Box</p></div>
                              <div className="p-4 flex flex-col-reverse gap-3 max-h-48 overflow-y-auto bg-slate-50/30">
                                {[...activeClaim.messages].reverse().map((msg, idx) => (
                                  <div key={idx} className={`p-3 rounded-xl text-sm shadow-sm max-w-[85%] ${msg.senderRole === "Consultant" ? "bg-white border border-blue-100 mr-auto" : "bg-blue-600 text-white ml-auto"}`}><p className={`text-[9px] font-bold mb-1 ${msg.senderRole === "Consultant" ? "text-blue-400" : "text-blue-200"}`}>{msg.senderName} • {msg.time}</p>{msg.text}</div>
                                ))}
                              </div>
                              <div className="p-4 bg-white border-t border-blue-100">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Reply</label>
                                <textarea value={hoReplyText} onChange={(e) => setHoReplyText(e.target.value)} placeholder="Type your response to the consultant's query here..." className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm mb-3 outline-none focus:ring-2 focus:ring-blue-500 min-h-20" />
                                <button onClick={resubmitOrderWithUpdates} disabled={loading || hoReplyText.trim().length === 0} className={`w-full py-3.5 rounded-xl font-black uppercase text-sm shadow-md transition-all flex justify-center items-center gap-2 ${loading || hoReplyText.trim().length === 0 ? "bg-slate-300 text-slate-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                                  {loading ? "RE-AUDITING..." : hoReplyText.trim().length === 0 ? "TYPE A REPLY TO CONTINUE" : "Update Notes & Send Reply"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Assign Peer Reviewers ({selectedReviewers.length}/{getRequiredCount()})</p>
                              <div className="grid grid-cols-1 gap-2">
                                {staffDirectory.filter((doc) => ["Cons", "SR"].includes(doc.rank) && doc.id !== currentDoc.id).map((doc) => (
                                  <button key={doc.id} onClick={() => toggleReviewer(doc)} className={`p-3 rounded-xl border text-left flex justify-between items-center transition-all ${selectedReviewers.find((r) => r.id === doc.id) ? "border-blue-600 bg-blue-50" : "bg-white border-slate-100 hover:border-blue-200"}`}>
                                    <div className="flex items-center gap-2"><div className="w-8 h-8 bg-slate-200 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold uppercase">{doc.rank}</div><div><p className="text-xs font-bold leading-none">{doc.name}</p></div></div>{selectedReviewers.find((r) => r.id === doc.id) && <span className="text-blue-600 text-xs font-bold">✓</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button disabled={selectedReviewers.length < getRequiredCount()} onClick={handleReviewSubmit} className={`w-full py-4 rounded-2xl font-black uppercase transition-all shadow-lg ${selectedReviewers.length < getRequiredCount() ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none" : "bg-slate-900 text-white hover:bg-black"}`}>
                              {selectedReviewers.length < getRequiredCount() ? `SELECT ${getRequiredCount() - selectedReviewers.length} MORE REVIEWER(S)` : "FORWARD FOR REVIEW"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {/* ========================================== */}
      {/* SCREEN 2: SENIOR CONSULTANT DASHBOARD      */}
      {/* ========================================== */}
      {appMode === "REVIEW" && currentDoc.rank === "Cons" && (
        <main className="flex-1 p-6 md:p-12 bg-slate-100">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-black tracking-tight text-slate-800 mb-2">Senior Consultant Dashboard</h1>
            <p className="text-sm text-slate-500 mb-8 font-medium">Review, Query, and Authorize AI-flagged clinical orders.</p>
            {myConsultantQueue.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-dashed border-slate-300">
                <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No Assigned Reviews</p>
                <p className="text-slate-400 text-xs mt-2">No Junior Doctors have assigned clinical requests to you.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {[...myConsultantQueue].reverse().map((claim) => (
                  <div key={claim.id} className="bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden">
                    <div className={`p-4 flex justify-between items-center ${claim.status === "PENDING" ? "bg-amber-50 border-b border-amber-100" : claim.status === "NEEDS_INFO" ? "bg-blue-50 border-b border-blue-100" : claim.status === "APPROVED" ? "bg-emerald-50 border-b border-emerald-100" : claim.status === "DISPATCHED" ? "bg-slate-100 border-b border-slate-200" : "bg-rose-50 border-b border-rose-100"}`}>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase text-white ${claim.status === "PENDING" ? "bg-amber-500" : claim.status === "NEEDS_INFO" ? "bg-blue-500" : claim.status === "APPROVED" ? "bg-emerald-500" : claim.status === "DISPATCHED" ? "bg-slate-500" : "bg-rose-500"}`}>{claim.status.replace("_", " ")}</span>
                        <span className="font-mono text-xs font-bold text-slate-500">{claim.id}</span>
                        {(claim.status === "APPROVED" || claim.status === "REJECTED" || claim.status === "DISPATCHED") && claim.resolvedBy && <span className="text-[10px] font-bold text-slate-500 bg-white/50 px-2 py-1 rounded-full border border-white">By {claim.resolvedBy}</span>}
                      </div>
                      <p className="text-xs font-bold text-slate-500">From: <span className="text-slate-800">{claim.doctorName}</span></p>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Requested Procedure</p>
                        <p className="text-lg font-bold text-slate-800 mb-4">{claim.testName}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Current Clinical Notes</p>
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm italic text-slate-600 mb-4 shadow-inner">&ldquo;{claim.notes}&rdquo;</div>
                        {claim.messages.length > 0 && (
                          <div className="mt-4 border-t border-slate-100 pt-4">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Conversation History</p>
                            <div className="flex flex-col-reverse gap-2 max-h-40 overflow-y-auto pr-1">
                              {[...claim.messages].reverse().map((msg, idx) => {
                                const isMe = msg.senderName === currentDoc?.name;
                                const isOtherCons = msg.senderRole === "Consultant" && !isMe;
                                return (
                                  <div key={idx} className={`p-2 rounded-lg text-sm shadow-sm ${isMe ? "bg-blue-100 text-blue-900 ml-8 text-right" : isOtherCons ? "bg-indigo-50 border border-indigo-100 text-indigo-900 mr-8" : "bg-slate-100 border border-slate-200 mr-8"}`}>
                                    <p className="text-[9px] font-bold text-slate-400 mb-1">{msg.senderName} • {msg.time}</p>{msg.text}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4 flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">AI Confidence Score</span><span className={`text-2xl font-black ${claim.aiScore >= 0.9 ? "text-emerald-500" : claim.aiScore >= 0.75 ? "text-amber-500" : "text-rose-500"}`}>{Math.round(claim.aiScore * 100)}%</span></div>
                          <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">AI Reasoning</p>
                            <p className="text-xs text-blue-800 leading-relaxed">{claim.aiReasoning}</p>
                            {claim.suggestions && claim.suggestions.length > 0 && (
                              <div className="mt-3 border-t border-blue-200/60 pt-3">
                                <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1 flex items-center gap-1">💡 Actionable Suggestions</p>
                                <ul className="list-disc pl-4 space-y-1">
                                  {claim.suggestions.map((sug: string, i: number) => <li key={i} className="text-[10px] text-blue-800 font-medium leading-relaxed">{sug}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4">
                          <textarea value={consultantDrafts[claim.id] || ""} onChange={(e) => setConsultantDrafts({ ...consultantDrafts, [claim.id]: e.target.value })} placeholder={claim.status === "PENDING" ? "Type a query or note..." : "Add a post-review audit comment..."} className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 mb-2" />
                          {claim.status === "PENDING" ? (
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => handleConsultantAction(claim.id, "NEEDS_INFO")} disabled={!consultantDrafts[claim.id]} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-black uppercase text-[10px] hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-md">💬 Send Query</button>
                              <button onClick={() => handleConsultantAction(claim.id, "APPROVED")} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-black uppercase text-[10px] hover:bg-emerald-700 transition-colors shadow-md">✅ Authorize</button>
                              <button onClick={() => handleConsultantAction(claim.id, "REJECTED")} className="flex-1 bg-rose-100 text-rose-700 py-3 rounded-xl font-black uppercase text-[10px] hover:bg-rose-200 transition-colors shadow-md">❌ Reject</button>
                            </div>
                          ) : (
                            <button onClick={() => handleConsultantAction(claim.id, "COMMENT")} disabled={!consultantDrafts[claim.id]} className="w-full bg-slate-800 text-white py-3 rounded-xl font-black uppercase text-xs hover:bg-slate-700 transition-colors disabled:opacity-50 shadow-md">Leave Audit Comment</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}