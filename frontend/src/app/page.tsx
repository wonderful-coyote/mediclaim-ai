"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL = "https://wonderfulcoyote-mediclaim-ai.hf.space";
// const API_BASE_URL = "http://127.0.0.1:8000";

type DoctorRank = "HO" | "MO" | "JR" | "SR" | "Cons";
type ClaimStatus = "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "DISPATCHED";

interface Doctor {
  id: string;
  name: string;
  rank: DoctorRank;
  dept: string;
}

interface AuditResult {
  status: "AUTHORIZED" | "PARTIAL_PAYMENT" | "FINANCE_REFERRAL" | "REJECTED" | "PENDING";
  audit_score: number;
  payout_tier: string;
  requires_hmo_review?: boolean;
  adjudication_mode?: "AUTO_APPROVE" | "MANUAL_REVIEW" | "AUTO_REJECT" | "AUTO_SELF_PAY";
  deducted: number;
  remaining: number;
  new_wallet_balance: number;
  new_balance?: number;
  message: string;
  paycode?: string;
  reasoning?: string;
  clinical_indication?: string;
  suggestions?: string[];
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
  status: ClaimStatus;
  messages: Message[];
  reviewerIds: string[];
  reviewerNames: string[];
  resolvedBy?: string;
  deductedAmount: number;
  paycode?: string;
  clinicalIndication?: string;
  payout_tier?: string;
  suggestions?: string[];
  total_cost?: number;
  hmo_payout?: number;
  settlement_status?: string;
  isArchived?: boolean;
  patientId?: string;
  patientName?: string;
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

interface PatientProfile {
  name: string;
  gender: string;
  virtual_account: string;
}

const staffDirectory: Doctor[] = [
  { id: "DOC-001", name: "Dr. Kunle Ade", rank: "Cons", dept: "Radiology" },
  { id: "DOC-002", name: "Dr. Amaka V.", rank: "Cons", dept: "Internal Med" },
  { id: "DOC-003", name: "Dr. Sarah J.", rank: "SR", dept: "Radiology" },
  { id: "DOC-004", name: "Dr. Chidi Oke", rank: "MO", dept: "Surgery" },
  { id: "DOC-005", name: "Dr. Ogooluwa Isaac", rank: "HO", dept: "Radiology" },
];

const patientDirectory: Record<string, PatientProfile> = {
  "PT-1029": { name: "Ogooluwa Isaac", gender: "Male", virtual_account: "9920102933" },
  "PT-2045": { name: "Amaka Okafor", gender: "Female", virtual_account: "9920204533" },
  "PT-3088": { name: "Bayo Adeyemi", gender: "Male", virtual_account: "9920308833" },
  "PT-4012": { name: "Chioma Eze", gender: "Female", virtual_account: "9920401233" },
};

const getPlanDetails = (id: string) => {
  if (id === "PT-1029") return { name: "MediClaim ValuCare" };
  if (id === "PT-2045") return { name: "MediClaim EasyCare" };
  if (id === "PT-3088") return { name: "MediClaim FlexiCare" };
  if (id === "PT-4012") return { name: "MediClaim Malaria Plan" };
  return { name: "Unknown Plan" };
};

const getPatientProfile = (patientId: string): PatientProfile =>
  patientDirectory[patientId] || {
    name: "Unknown Patient",
    gender: "Unknown",
    virtual_account: "0000000000",
  };

const buildClaimId = () => `CLM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

export default function EHRTerminal() {
  const [isMounted, setIsMounted] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<Doctor | null>(null);
  const [loginUserId, setLoginUserId] = useState<string>(staffDirectory[4].id);
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginError, setLoginError] = useState(false);

  const [reviewQueue, setReviewQueue] = useState<QueuedClaim[]>([]);
  const [patientId, setPatientId] = useState<string>("PT-1029");
  const [balance, setBalance] = useState<number>(50000);
  const planDetails = getPlanDetails(patientId);
  const patientProfile = getPatientProfile(patientId);

  const [appMode, setAppMode] = useState<"ORDER" | "REVIEW">("ORDER");
  const [status, setStatus] = useState<string>("System Ready");
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setSelectedReviewers] = useState<Doctor[]>([]);
  const [testList, setTestList] = useState<Investigation[]>([]);
  const [selectedTest, setSelectedTest] = useState<Investigation | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState<string>("");
  const [isReviewing, setIsReviewing] = useState(false);
  const [hoReplyText, setHoReplyText] = useState<string>("");
  const [loadedClaimId, setLoadedClaimId] = useState<string | null>(null);
  const [draftClaimId, setDraftClaimId] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [isEmailing, setIsEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const activeClaim = useMemo(() => {
    if (!currentDoc) return null;
    return (
      reviewQueue
        .slice()
        .reverse()
        .find(
          (q: QueuedClaim) =>
            q.doctorName === currentDoc.name &&
            q.patientId === patientId &&
            q.status !== "DISPATCHED" &&
            !q.isArchived,
        ) || null
    );
  }, [currentDoc, patientId, reviewQueue]);

  const hoNotificationCount = reviewQueue.filter(
    (q: QueuedClaim) =>
      q.doctorName === currentDoc?.name &&
      q.patientId === patientId &&
      ["NEEDS_INFO", "APPROVED", "REJECTED"].includes(q.status),
  ).length;

  const hasComplaint =
    /(presenting\s*complaint|complaint|\bc\/?o\b|\bhpi\b|history|symptom|\bp\/?c\b|\bhpc\b)/i.test(
      clinicalNotes,
    );
  const hasDiagnosis =
    /(diagnos[ei]s|\bdx\b|differential|\bddx\b|assessment|assess|\bimp\b|impression)/i.test(
      clinicalNotes,
    );
  const isNotesValid = clinicalNotes.trim().length >= 10 && hasComplaint && hasDiagnosis;

  const refreshPatientBalance = useCallback(
    async (targetPatientId: string = patientId): Promise<void> => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/patient/${targetPatientId}`);
        if (res.ok) {
          const data = await res.json();
          setBalance(Number(data.balance || 0));
        }
      } catch {
        // ignore transient poll errors
      }
    },
    [patientId],
  );

  const refreshQueue = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/ehr/queue`);
      if (res.ok) {
        const data = await res.json();
        setReviewQueue(Array.isArray(data) ? data : []);
        setIsReviewing(false);
      }
    } catch (e) {
      console.error("Queue sync error", e);
    }
  }, []);

  useEffect(() => {
    void refreshPatientBalance(patientId);
    const interval = setInterval(() => {
      void refreshPatientBalance(patientId);
    }, 3000);
    return () => clearInterval(interval);
  }, [patientId, refreshPatientBalance]);

  useEffect(() => {
    setIsMounted(true);
    void refreshQueue();
    const interval = setInterval(() => {
      void refreshQueue();
    }, 3000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  const syncClaimToDB = async (claim: QueuedClaim): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claim),
      });
    } catch (e) {
      console.error("Sync error", e);
    }
  };

  const deleteClaimFromQueue = async (claimId: string): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/queue/${claimId}`, { method: "DELETE" });
    } catch (e) {
      console.error("Queue delete error", e);
    }
  };

  useEffect(() => {
    if (activeClaim && activeClaim.id !== loadedClaimId) {
      setClinicalNotes(activeClaim.notes);
      if (testList.length > 0) {
        const foundTest = testList.find((t: Investigation) => t.name === activeClaim.testName);
        if (foundTest) setSelectedTest(foundTest);
      }
      setLoadedClaimId(activeClaim.id);
      setDraftClaimId(activeClaim.id);
    }
  }, [activeClaim, loadedClaimId, testList]);

  const saveToDatabase = async (params: {
    claimId: string;
    patientId: string;
    docName: string;
    testName: string;
    score: number;
    finalStatus: string;
    resolver: string;
    deducted?: number;
    paycode?: string;
    clinicalIndication?: string;
    totalCost?: number;
    hmoPayout?: number;
    settlementStatus?: string;
    reasoning?: string;
    notes?: string;
    suggestions?: string[];
    messages?: Message[];
  }): Promise<void> => {
    const {
      claimId,
      patientId: ledgerPatientId,
      docName,
      testName,
      score,
      finalStatus,
      resolver,
      deducted = 0,
      paycode,
      clinicalIndication = "",
      totalCost = 50000,
      hmoPayout = 40000,
      settlementStatus = "PENDING_AI_AUDIT",
      reasoning = "",
      notes = "",
      suggestions = [],
      messages = [],
    } = params;

    try {
      await fetch(`${API_BASE_URL}/api/v1/ehr/audit-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          patient_id: ledgerPatientId,
          doctor_name: docName,
          procedure_name: testName,
          clinical_indication: clinicalIndication,
          ai_score: score,
          status: finalStatus,
          resolved_by: resolver,
          deducted_amount: deducted,
          paycode: paycode || null,
          total_cost: totalCost,
          hmo_payout: hmoPayout,
          settlement_status: settlementStatus,
          reasoning,
          notes,
          suggestions,
          messages,
        }),
      });
    } catch (e) {
      console.error("Failed to save to DB:", e);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/clinical/dictionary/${patientId}`)
      .then((res) => res.json())
      .then((data: Investigation[] | unknown) => {
        const list = Array.isArray(data) ? (data as Investigation[]) : [];
        setTestList(list);

        if (list.length > 0 && !activeClaim) {
          setSelectedTest(list[0]);
        } else if (list.length === 0) {
          setSelectedTest(null);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch dictionary", err);
        setTestList([]);
        setSelectedTest(null);
      });
  }, [activeClaim, patientId]);

  const processOrder = async (): Promise<void> => {
    if (auditResult || !selectedTest || !currentDoc || !isNotesValid) return;
    setLoading(true);
    setStatus("Syncing Ledger...");

    const claimId = draftClaimId || buildClaimId();
    setDraftClaimId(claimId);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/ehr/order-procedure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          initiator_rank: currentDoc.rank,
          clinical_notes: clinicalNotes,
          procedure_id: selectedTest.id,
          procedure_name: selectedTest.name,
          patient: {
            id: patientId,
            name: patientProfile.name,
            gender: patientProfile.gender,
            virtual_account: patientProfile.virtual_account,
            wallet_balance: Number(balance),
          },
          hospital_id: "HOSP-01",
          amount: selectedTest.cost,
        }),
      });

      if (!response.ok) throw new Error("Server Error");
      const data: AuditResult = await response.json();

      setAuditResult(data);
      setStatus("COMPLETED");

      if (data.status === "REJECTED") {
        await saveToDatabase({
          claimId,
          patientId,
          docName: currentDoc.name,
          testName: selectedTest.name,
          score: data.audit_score,
          finalStatus: "REJECTED",
          resolver: "AI Auto-Rejected",
          deducted: 0,
          paycode: data.paycode,
          clinicalIndication: data.clinical_indication || "",
          totalCost: data.total_cost || selectedTest.cost,
          hmoPayout: data.hmo_payout || 0,
          settlementStatus: data.settlement_status || "AUTO_CLINICAL_REJECTED",
          reasoning: data.reasoning || "",
          notes: clinicalNotes,
          suggestions: data.suggestions || [],
          messages: [],
        });
      }
    } catch (e) {
      console.error("Fetch Error:", e);
      setStatus("OFFLINE: Check Connection");
    } finally {
      setLoading(false);
    }
  };

  const handleReviewSubmit = async (): Promise<void> => {
    if (!currentDoc || !selectedTest || !auditResult || !auditRequiresHmoReview) return;
    setIsReviewing(true);

    const claimId = draftClaimId || buildClaimId();
    setDraftClaimId(claimId);

    const newTicket: QueuedClaim = {
      id: claimId,
      doctorName: currentDoc.name,
      testName: selectedTest.name,
      patientId,
      patientName: patientProfile.name,
      notes: clinicalNotes,
      aiScore: auditResult.audit_score || 0,
      aiReasoning: auditResult.reasoning || "No reasoning provided.",
      status: "PENDING",
      messages: [],
      reviewerIds: ["HMO-PROVIDER"],
      reviewerNames: ["Insurance Provider"],
      deductedAmount: auditResult.deducted || 0,
      paycode: auditResult.paycode,
      clinicalIndication: auditResult.clinical_indication || "",
      payout_tier: auditResult.payout_tier,
      suggestions: auditResult.suggestions || [],
      total_cost: auditResult.total_cost || selectedTest.cost || 50000,
      hmo_payout: auditResult.hmo_payout ?? selectedTest.cost ?? 50000,
      settlement_status: auditResult.settlement_status || "PENDING_HMO_REVIEW",
      resolvedBy: "Pending Review",
    };

    setReviewQueue((prev: QueuedClaim[]) => {
      const existing = prev.some((q: QueuedClaim) => q.id === claimId);
      return existing ? prev.map((q: QueuedClaim) => (q.id === claimId ? newTicket : q)) : [...prev, newTicket];
    });
    await syncClaimToDB(newTicket);

    await saveToDatabase({
      claimId: newTicket.id,
      patientId,
      docName: newTicket.doctorName,
      testName: newTicket.testName,
      score: newTicket.aiScore,
      finalStatus: "PENDING",
      resolver: "Pending Review",
      deducted: newTicket.deductedAmount,
      paycode: newTicket.paycode,
      clinicalIndication: newTicket.clinicalIndication || "",
      totalCost: newTicket.total_cost,
      hmoPayout: newTicket.hmo_payout,
      settlementStatus: newTicket.settlement_status,
      reasoning: newTicket.aiReasoning,
      notes: newTicket.notes,
      suggestions: newTicket.suggestions || [],
      messages: newTicket.messages,
    });
  };

  const resubmitOrderWithUpdates = async (): Promise<void> => {
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
          patient: {
            id: activeClaim.patientId || patientId,
            name: activeClaim.patientName || patientProfile.name,
            gender: patientProfile.gender,
            virtual_account: patientProfile.virtual_account,
            wallet_balance: Number(balance),
          },
          hospital_id: "HOSP-01",
          amount: selectedTest.cost,
        }),
      });

      if (!response.ok) throw new Error("Server Error");
      const data: AuditResult = await response.json();

      setAuditResult(data);
      const responseMessage: Message = {
        senderRole: "HO",
        senderName: currentDoc.name,
        text: hoReplyText,
        time: new Date().toLocaleTimeString(),
      };

      const updatedClaim: QueuedClaim = {
        ...activeClaim,
        patientId: activeClaim.patientId || patientId,
        patientName: activeClaim.patientName || patientProfile.name,
        notes: clinicalNotes,
        aiScore: data.audit_score,
        aiReasoning: data.reasoning || "Updated reasoning",
        deductedAmount: data.deducted || 0,
        paycode: data.paycode,
        clinicalIndication: data.clinical_indication || "",
        payout_tier: data.payout_tier,
        suggestions: data.suggestions || [],
        total_cost: data.total_cost,
        hmo_payout: data.hmo_payout,
        settlement_status: data.settlement_status,
        status: "PENDING",
        messages: [...activeClaim.messages, responseMessage],
      };

      if (data.status === "REJECTED") {
        await deleteClaimFromQueue(activeClaim.id);
        setReviewQueue((prev: QueuedClaim[]) => prev.filter((q: QueuedClaim) => q.id !== activeClaim.id));
        await saveToDatabase({
          claimId: activeClaim.id,
          patientId: activeClaim.patientId || patientId,
          docName: activeClaim.doctorName,
          testName: activeClaim.testName,
          score: data.audit_score,
          finalStatus: "REJECTED",
          resolver: "AI Auto-Rejected",
          deducted: 0,
          paycode: data.paycode,
          clinicalIndication: data.clinical_indication || "",
          totalCost: data.total_cost || activeClaim.total_cost || selectedTest.cost,
          hmoPayout: data.hmo_payout || 0,
          settlementStatus: data.settlement_status || "AUTO_CLINICAL_REJECTED",
          reasoning: data.reasoning || "",
          notes: clinicalNotes,
          suggestions: data.suggestions || [],
          messages: [...activeClaim.messages, responseMessage],
        });
      } else if ((data.adjudication_mode === "AUTO_APPROVE") || data.payout_tier === "Instant Payout" || data.settlement_status === "INSTANT_SETTLED") {
        await deleteClaimFromQueue(activeClaim.id);
        setReviewQueue((prev: QueuedClaim[]) => prev.filter((q: QueuedClaim) => q.id !== activeClaim.id));
      } else {
        setReviewQueue((prev: QueuedClaim[]) =>
          prev.map((q: QueuedClaim) => (q.id === activeClaim.id ? updatedClaim : q)),
        );
        await syncClaimToDB(updatedClaim);
      }

      setHoReplyText("");
    } catch (e) {
      console.error("Fetch Error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalDispatch = async (): Promise<void> => {
    const ledgerPatientId = activeClaim?.patientId || patientId;
    const ledgerPatientName = activeClaim?.patientName || patientProfile.name;
    const finalAmountToDeduct = auditResult?.deducted ?? activeClaim?.deductedAmount ?? 0;
    const finalPaycode = auditResult?.paycode ?? activeClaim?.paycode;
    const procedureName = selectedTest?.name || activeClaim?.testName || "Medical Procedure";
    const dept = selectedTest?.dept || "General";
    const totalCost =
      auditResult?.total_cost ?? activeClaim?.total_cost ?? selectedTest?.cost ?? 0;
    const hmoAmount =
      auditResult?.hmo_payout ?? activeClaim?.hmo_payout ?? selectedTest?.cost ?? 0;
    const copayAmount = Math.max(totalCost - hmoAmount, 0);
    const claimId = activeClaim?.id || draftClaimId || buildClaimId();

    let finalResolver = activeClaim?.resolvedBy || "AI Auto-Approved";
    let finalScore = auditResult?.audit_score ?? activeClaim?.aiScore ?? 0;
    let finalIndication = auditResult?.clinical_indication ?? activeClaim?.clinicalIndication ?? "";
    let finalReasoning = auditResult?.reasoning ?? activeClaim?.aiReasoning ?? "";
    let finalSettlementStatus =
      auditResult?.settlement_status ||
      (activeClaim?.status === "APPROVED"
        ? "SETTLED"
        : activeClaim?.settlement_status || "PENDING_AI_AUDIT");

    if (activeClaim) {
      const updatedClaim: QueuedClaim = {
        ...activeClaim,
        status: "DISPATCHED",
        resolvedBy: finalResolver,
        deductedAmount: finalAmountToDeduct,
        paycode: finalPaycode,
        clinicalIndication: finalIndication,
        aiReasoning: finalReasoning,
        aiScore: finalScore,
        total_cost: totalCost,
        hmo_payout: hmoAmount,
        settlement_status: finalSettlementStatus,
      };
      setReviewQueue((prev: QueuedClaim[]) =>
        prev.map((q: QueuedClaim) => (q.id === activeClaim.id ? updatedClaim : q)),
      );
      await syncClaimToDB(updatedClaim);
      finalResolver = updatedClaim.resolvedBy || finalResolver;
      finalScore = updatedClaim.aiScore;
      finalIndication = updatedClaim.clinicalIndication || finalIndication;
      finalReasoning = updatedClaim.aiReasoning || finalReasoning;
      finalSettlementStatus = updatedClaim.settlement_status || finalSettlementStatus;
    }

    await saveToDatabase({
      claimId,
      patientId: ledgerPatientId,
      docName: activeClaim?.doctorName || currentDoc?.name || "Unknown Doctor",
      testName: activeClaim?.testName || procedureName,
      score: finalScore,
      finalStatus: "DISPATCHED",
      resolver: finalResolver,
      deducted: finalAmountToDeduct,
      paycode: finalPaycode,
      clinicalIndication: finalIndication,
      totalCost,
      hmoPayout: hmoAmount,
      settlementStatus: finalSettlementStatus,
      reasoning: finalReasoning,
      notes: clinicalNotes || activeClaim?.notes || "",
      suggestions: auditResult?.suggestions || activeClaim?.suggestions || [],
      messages: activeClaim?.messages || [],
    });

    await refreshPatientBalance(ledgerPatientId);

    setReceiptData({
      hospitalName: "MediClaim Hospital",
      patientName: ledgerPatientName,
      patientId: ledgerPatientId,
      procedure: procedureName,
      department: dept,
      date: new Date().toLocaleString(),
      reference: claimId,
      amountDeducted: finalAmountToDeduct,
      hmoAmount,
      patientCopay: copayAmount,
      totalCost,
      paycode: finalPaycode,
      resolvedBy: finalResolver,
    });
    setEmailSent(false);
  };

  const closeReceiptAndReset = (): void => {
    setReceiptData(null);
    setAuditResult(null);
    setStatus("System Ready");
    setSelectedReviewers([]);
    setClinicalNotes("");
    setIsReviewing(false);
    setHoReplyText("");
    setLoadedClaimId(null);
    setDraftClaimId(null);
  };

  const handleEmailReceipt = (): void => {
    setIsEmailing(true);
    setTimeout(() => {
      setIsEmailing(false);
      setEmailSent(true);
    }, 1500);
  };

  const handleLogin = (e: React.FormEvent): void => {
    e.preventDefault();
    if (loginPassword === "123") {
      const doc = staffDirectory.find((d: Doctor) => d.id === loginUserId);
      if (doc) {
        setCurrentDoc(doc);
        setAppMode(doc.rank === "Cons" ? "REVIEW" : "ORDER");
      }
      setLoginError(false);
      setLoadedClaimId(null);
      setDraftClaimId(null);
    } else {
      setLoginError(true);
    }
  };

  if (!isMounted) return null;

  const displayHoldAmount = auditResult?.deducted ?? activeClaim?.deductedAmount ?? 0;
  const auditRequiresHmoReview = !!auditResult && ((auditResult.requires_hmo_review ?? false) || auditResult.settlement_status === "PENDING_HMO_REVIEW" || auditResult.status === "PENDING");
  const auditIsAutoRejected = !!auditResult && auditResult.status === "REJECTED";
  const auditIsSelfPayCheckout = !!auditResult && auditResult.status !== "REJECTED" && (auditResult.adjudication_mode === "AUTO_SELF_PAY" || String(auditResult.settlement_status || "").startsWith("PATIENT_RESPONSIBLE"));
  const auditIsAutoApproved = !!auditResult && !auditRequiresHmoReview && !auditIsSelfPayCheckout && auditResult.status !== "REJECTED" && (auditResult.adjudication_mode === "AUTO_APPROVE" || auditResult.payout_tier === "Instant Payout" || auditResult.settlement_status === "INSTANT_SETTLED");

  if (!currentDoc) {
    return (
      <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-10 rounded-3xl shadow-2xl">
          <div className="w-16 h-16 bg-blue-600 rounded-full mx-auto mb-6 flex items-center justify-center">
            <span className="text-white text-2xl font-black">MC</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mb-2 text-center">
            Doctor Portal
          </h1>
          <p className="text-sm text-slate-400 mb-8 text-center">
            Authenticate into access the doctor&apos;s portal.
          </p>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Practitioner Identity
              </label>
              <select
                value={loginUserId}
                onChange={(e) => setLoginUserId(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-white outline-none focus:border-blue-500 font-bold"
              >
                {staffDirectory.map((doc: Doctor) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name} ({doc.rank} - {doc.dept})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Network Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter password (123)"
                className={`w-full p-4 rounded-xl bg-slate-800 border text-white outline-none focus:border-blue-500 ${loginError ? "border-rose-500" : "border-slate-700"}`}
              />
              {loginError && (
                <p className="text-rose-500 text-xs mt-2 font-bold">
                  Incorrect password. Hint: Use 123.
                </p>
              )}
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-blue-700 transition-colors mt-4"
            >
              Secure Login
            </button>
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
              <div className="w-12 h-12 bg-white text-slate-900 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">✓</span>
              </div>
              <h2 className="text-xl font-black tracking-tight mb-1">Payment Successful</h2>
              <p className="text-slate-400 text-xs uppercase tracking-widest font-bold">
                Interswitch Virtual Wallet
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Hospital</p>
                  <p className="text-sm font-bold text-slate-800">{receiptData.hospitalName}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Reference</p>
                  <p className="text-xs font-mono text-slate-800 bg-slate-100 px-2 py-1 rounded">{receiptData.reference}</p>
                </div>
              </div>
              <div className="space-y-3 border-b border-slate-100 pb-4">
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Date</span><span className="text-xs font-bold text-slate-800">{receiptData.date}</span></div>
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Patient</span><span className="text-xs font-bold text-slate-800">{receiptData.patientName} ({receiptData.patientId})</span></div>
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Procedure</span><span className="text-xs font-bold text-slate-800 text-right">{receiptData.procedure}<br /><span className="text-[10px] text-slate-400">({receiptData.department})</span></span></div>
                <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Authorized By</span><span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">{receiptData.resolvedBy}</span></div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Procedure Cost</span><span className="text-sm font-black text-slate-800">₦{receiptData.totalCost.toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-xs font-bold text-slate-500">HMO Covered Amount</span></div><span className="text-xs font-black text-blue-600">₦{receiptData.hmoAmount.toLocaleString()}</span></div>
                <div className="flex justify-between items-center"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-xs font-bold text-slate-500">Out-of-Pocket Balance</span></div><span className="text-xs font-black text-amber-600">₦{receiptData.patientCopay.toLocaleString()}</span></div>
                <div className="border-t border-slate-200 pt-2">
                  <div className="flex justify-between items-center"><span className="text-xs font-black text-slate-600 uppercase">Charged to Smart Card</span><span className="text-lg font-black text-emerald-600">₦{receiptData.amountDeducted.toLocaleString()}</span></div>
                  {receiptData.amountDeducted < receiptData.patientCopay && (
                    <div className="flex justify-between items-center mt-1"><span className="text-xs font-bold text-rose-500">Outstanding Balance</span><span className="text-sm font-black text-rose-600">₦{(receiptData.patientCopay - receiptData.amountDeducted).toLocaleString()}</span></div>
                  )}
                </div>
                {receiptData.paycode && (
                  <div className="mt-1 pt-3 border-t border-dashed border-rose-200 bg-rose-50 -mx-4 -mb-4 px-4 pb-4 rounded-b-xl">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest block mb-1">Balance Due — Patient Paycode</span>
                        <span className="text-base font-mono font-black tracking-widest text-slate-800 bg-white px-3 py-1.5 rounded-lg border border-rose-200 shadow-sm">{receiptData.paycode}</span>
                      </div>
                      <div className="text-right mt-1">
                        <span className="text-[10px] text-slate-500 block">Amount Due</span>
                        <span className="text-sm font-black text-rose-600">₦{(receiptData.patientCopay - receiptData.amountDeducted).toLocaleString()}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-rose-400 font-bold mt-2">Direct patient to Cashier or POS terminal with this code.</p>
                  </div>
                )}
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-200 space-y-3">
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold text-xs uppercase tracking-wide hover:bg-slate-100 transition-colors shadow-sm">🖨️ Print</button>
                <button
                  onClick={handleEmailReceipt}
                  disabled={isEmailing || emailSent}
                  className={`flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-colors shadow-sm ${emailSent ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"}`}
                >
                  {isEmailing ? "Sending..." : emailSent ? "✓ Sent to Patient" : "✉️ Email Receipt"}
                </button>
              </div>
              <button onClick={closeReceiptAndReset} className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-black transition-colors shadow-md">Done & Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full bg-slate-900 text-white p-3 flex justify-between items-center px-6 shadow-md z-40 relative">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-black tracking-widest text-xs uppercase text-slate-300 hidden md:block">MediClaim Network</span>
        </div>

        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1.5 border border-slate-700">
          <span className="text-[10px] uppercase font-bold text-slate-400 pl-2">Patient:</span>
          <select
            value={patientId}
            onChange={(e) => {
              setPatientId(e.target.value);
              setAuditResult(null);
              setClinicalNotes("");
              setLoadedClaimId(null);
              setDraftClaimId(null);
            }}
            className="bg-slate-900 border border-slate-600 text-white text-xs font-bold px-2 py-1 rounded outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="PT-1029">PT-1029 (Isaac - ValuCare)</option>
            <option value="PT-2045">PT-2045 (Amaka - EasyCare)</option>
            <option value="PT-3088">PT-3088 (Bayo - FlexiCare)</option>
            <option value="PT-4012">PT-4012 (Chioma - Malaria Plan)</option>
          </select>
        </div>

        <div className="flex items-center gap-4 bg-slate-800 rounded-lg p-1.5 border border-slate-700 pr-4">
          <div className={`text-white w-8 h-8 rounded-md flex items-center justify-center font-bold text-[10px] uppercase ${currentDoc.rank === "Cons" ? "bg-amber-600" : "bg-blue-600"}`}>
            {currentDoc.rank}
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-bold leading-none">{currentDoc.name}</span>
            <span className="text-[9px] text-slate-400 uppercase">{currentDoc.dept} Dept</span>
          </div>
          <div className="h-6 w-px bg-slate-600 mx-2" />
          <button
            onClick={() => {
              setCurrentDoc(null);
              setLoginPassword("");
              setClinicalNotes("");
              setLoadedClaimId(null);
              setDraftClaimId(null);
              setAuditResult(null);
            }}
            className="text-[10px] uppercase tracking-widest font-black text-rose-400 hover:text-rose-300"
          >
            Log Out
          </button>
        </div>
      </div>

      {appMode === "ORDER" && currentDoc.rank !== "Cons" ? (
        <main className="flex-1 p-6 md:p-12 flex items-center justify-center">
          <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex justify-center items-center gap-2"><span>🔒</span> Patient Identity Card</p>
                <div className="bg-slate-900 p-8 rounded-2xl text-white shadow-xl relative min-h-55 flex flex-col justify-between overflow-hidden">
                  <div className="absolute -right-4 -top-4 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
                  <div className="relative z-10 flex justify-between items-start">
                    <div>
                      <p className="text-[10px] opacity-50 uppercase font-bold tracking-wider">Patient ID</p>
                      <p className="text-xl font-mono font-black tracking-tighter">{patientId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] opacity-50 uppercase font-bold tracking-wider">Smart Card Wallet</p>
                      <p className="text-xl font-black text-emerald-400 tracking-tighter">₦{(balance ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="space-y-4 relative z-10 mt-6 border-t border-slate-700/50 pt-4">
                    <div className="w-full">
                      <p className="text-[10px] opacity-50 uppercase font-bold tracking-wider mb-1">Active HMO Plan</p>
                      <p className="text-lg font-black text-blue-400 leading-tight">{planDetails.name}</p>
                      <div className="mt-3 flex items-start gap-2 bg-slate-800/80 border border-slate-700 p-2.5 rounded-lg">
                        <span className="text-rose-500 text-sm mt-0.5">🛡️</span>
                        <p className="text-[9px] font-bold text-slate-300 leading-relaxed">
                          <span className="text-rose-400 uppercase tracking-widest block mb-0.5 text-[8px]">Anti-Fraud Active</span>
                          HMO financial limits and sub-balances are hidden to prevent provider upcoding.
                        </p>
                      </div>
                    </div>
                  </div>
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
                <button onClick={() => setAuditResult(null)} className="mb-6 flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors">
                  &larr; Back to Edit Notes
                </button>
              )}

              <h2 className="text-2xl font-black text-slate-800 mb-8 flex justify-between items-center tracking-tight">
                EHR Clinical Order
                <span className="text-[9px] bg-slate-100 px-2 py-1 rounded text-slate-500 font-bold uppercase">{status}</span>
              </h2>

              {!auditResult && !activeClaim ? (
                <div className="animate-in fade-in">
                  <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Select Investigation / Procedure</p>
                    <select
                      className="w-full p-3 mb-3 rounded-xl border border-slate-200 bg-white font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                      onChange={(e) => {
                        const found = testList.find((t: Investigation) => t.id === e.target.value);
                        if (found) setSelectedTest(found);
                      }}
                      value={selectedTest?.id || ""}
                    >
                      {testList.length === 0 && <option value="">No procedures covered under this plan</option>}
                      {testList.map((test: Investigation) => (
                        <option key={test.id} value={test.id}>{test.name}</option>
                      ))}
                    </select>
                    {selectedTest && (
                      <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-100">
                        <span className="text-xs font-bold text-slate-500">{selectedTest.dept}</span>
                        <span className="text-xs text-slate-500">Total Cost: <strong className="text-slate-800">₦{selectedTest.cost.toLocaleString()}</strong></span>
                      </div>
                    )}
                  </div>
                  <div className="mb-6">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Clinical Justification (For AI Audit)</label>
                    <textarea
                      value={clinicalNotes}
                      onChange={(e) => setClinicalNotes(e.target.value)}
                      placeholder="E.g., Pt presents with P/C of right lower quadrant pain. Dx: Suspected Appendicitis..."
                      className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all min-h-25"
                    />
                    {!isNotesValid && clinicalNotes.trim().length > 0 && (
                      <p className="text-rose-500 text-[10px] font-bold mt-2">⚠️ Notes must include a Presenting Complaint (e.g., &ldquo;C/O:&rdquo;) AND a Diagnosis/Assessment (e.g., &ldquo;Dx:&rdquo;).</p>
                    )}
                  </div>
                  <button
                    onClick={processOrder}
                    disabled={loading || !selectedTest || !isNotesValid}
                    className={`w-full py-4 rounded-2xl font-black text-white transition-all shadow-lg ${!isNotesValid ? "bg-slate-300 cursor-not-allowed" : balance > 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-900 hover:bg-black"}`}
                  >
                    {loading ? "PROCESSING..." : !isNotesValid ? "ENTER P/C & DX TO UNLOCK" : balance > 0 ? "AUTHORIZE & AUDIT" : "AUTHORIZE & AUDIT (WALLET EMPTY)"}
                  </button>
                </div>
              ) : (
                <div className="animate-in slide-in-from-bottom-4">
                  <div className={`p-6 rounded-2xl border-2 mb-4 ${auditResult?.status === "AUTHORIZED" ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100"}`}>
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <h3 className={`text-lg font-black uppercase ${auditResult?.status === "AUTHORIZED" ? "text-emerald-800" : "text-amber-800"}`}>
                          {auditResult?.status?.replace("_", " ") || "REVIEW REQUIRED"}
                        </h3>
                        {selectedTest && <p className="text-sm font-bold text-slate-500 mt-1">{selectedTest.name}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">AI Score</p>
                        <p className="text-xl font-black">{Math.round((auditResult?.audit_score || activeClaim?.aiScore || 0) * 100)}%</p>
                      </div>
                    </div>
                    {(auditResult?.reasoning || activeClaim?.aiReasoning) && (
                      <div className="mb-4 p-3 bg-blue-50/50 rounded-lg border border-blue-100 text-xs text-blue-800 leading-relaxed">
                        <span className="font-black mr-2 tracking-tight">🧠 AI INSIGHT:</span>
                        {auditResult?.reasoning || activeClaim?.aiReasoning}
                      </div>
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
                    {auditIsAutoApproved ? (
                      <button onClick={handleFinalDispatch} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase shadow-lg hover:bg-emerald-700">
                        DISPATCH TO {selectedTest?.dept?.toUpperCase() || "UNIT"}
                      </button>
                    ) : auditIsSelfPayCheckout ? (
                      <div className="space-y-4 animate-in fade-in">
                        <div className="bg-blue-50 border border-blue-200 p-5 rounded-2xl">
                          <p className="text-blue-800 font-black text-sm uppercase mb-2">💳 Self-Pay Checkout Available</p>
                          <p className="text-blue-700 text-xs leading-relaxed mb-4">{auditResult?.reasoning || "This claim is clinically acceptable but not payable by the HMO. The patient can still proceed out of pocket."}</p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                            <div className="bg-white rounded-xl border border-blue-100 p-3">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Cost</p>
                              <p className="text-sm font-black text-slate-800">₦{(auditResult?.total_cost || activeClaim?.total_cost || selectedTest?.cost || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white rounded-xl border border-blue-100 p-3">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">HMO Cover</p>
                              <p className="text-sm font-black text-indigo-600">₦{(auditResult?.hmo_payout || activeClaim?.hmo_payout || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white rounded-xl border border-blue-100 p-3">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Patient Pays</p>
                              <p className="text-sm font-black text-emerald-600">₦{Math.max((auditResult?.total_cost || activeClaim?.total_cost || selectedTest?.cost || 0) - (auditResult?.hmo_payout || activeClaim?.hmo_payout || 0), 0).toLocaleString()}</p>
                            </div>
                          </div>
                        </div>
                        <button onClick={handleFinalDispatch} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase shadow-lg hover:bg-blue-700">
                          PROCEED TO CHECKOUT & DISPATCH
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {auditIsAutoRejected ? (
                          <div className="bg-rose-100 p-4 rounded-xl border border-rose-200 text-center animate-in fade-in">
                            <p className="text-rose-800 font-black text-sm uppercase mb-2">❌ Automatically Rejected</p>
                            <p className="text-rose-700 text-xs mb-4">{auditResult?.reasoning || "This claim failed policy or clinical auto-approval rules and was not sent for HMO review."}</p>
                            <button
                              onClick={() => {
                                setAuditResult(null);
                                setStatus("System Ready");
                              }}
                              className="w-full bg-white text-rose-700 py-3 rounded-xl font-bold text-sm hover:bg-rose-50 border border-rose-200"
                            >
                              &larr; Edit Notes or Start Over
                            </button>
                          </div>
                        ) : activeClaim?.status === "PENDING" || isReviewing ? (
                          <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-center animate-in fade-in mt-4 shadow-sm">
                            <div className="w-12 h-12 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4"><span className="font-black text-xl animate-pulse">⏳</span></div>
                            <p className="text-amber-800 font-black text-sm uppercase mb-2">Awaiting HMO Authorization</p>
                            <p className="text-amber-700 text-xs font-medium mb-2">Forwarded to: <strong className="font-black">Insurance Provider</strong></p>
                          </div>
                        ) : activeClaim?.status === "APPROVED" ? (
                          <div className="space-y-4 animate-in fade-in">
                            <div className="bg-emerald-100 p-4 rounded-xl border border-emerald-200 text-center">
                              <p className="text-emerald-800 font-black text-sm uppercase mb-1">✅ Insurance Provider Approved</p>
                              <p className="text-emerald-700 text-xs">Authorized by: <strong>{activeClaim.resolvedBy}</strong></p>
                            </div>
                            <button onClick={handleFinalDispatch} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase shadow-lg hover:bg-emerald-700">DISPATCH & PROCEED</button>
                          </div>
                        ) : activeClaim?.status === "REJECTED" ? (
                          <div className="bg-rose-100 p-4 rounded-xl border border-rose-200 text-center animate-in fade-in">
                            <p className="text-rose-800 font-black text-sm uppercase mb-2">❌ Claim Rejected</p>
                            <p className="text-rose-700 text-xs mb-4">Denied by: <strong>{activeClaim.resolvedBy}</strong>. Funds were not deducted.</p>
                            <button
                              onClick={() => {
                                const updatedClaim: QueuedClaim = { ...activeClaim, isArchived: true };
                                void syncClaimToDB(updatedClaim);
                                setReviewQueue((prev: QueuedClaim[]) => prev.map((q: QueuedClaim) => (q.id === activeClaim.id ? updatedClaim : q)));
                                setAuditResult(null);
                                setLoadedClaimId(null);
                                setDraftClaimId(activeClaim.id);
                              }}
                              className="w-full bg-white text-rose-700 py-3 rounded-xl font-bold text-sm hover:bg-rose-50 border border-rose-200"
                            >
                              &larr; Acknowledge & Edit Notes
                            </button>
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
                                {[...activeClaim.messages].reverse().map((msg: Message, idx: number) => (
                                  <div key={idx} className={`p-3 rounded-xl text-sm shadow-sm max-w-[85%] ${msg.senderRole === "HMO" ? "bg-white border border-blue-100 mr-auto" : "bg-blue-600 text-white ml-auto"}`}>
                                    <p className={`text-[9px] font-bold mb-1 ${msg.senderRole === "HMO" ? "text-blue-400" : "text-blue-200"}`}>{msg.senderName} • {msg.time}</p>
                                    {msg.text}
                                  </div>
                                ))}
                              </div>
                              <div className="p-4 bg-white border-t border-blue-100">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Reply</label>
                                <textarea value={hoReplyText} onChange={(e) => setHoReplyText(e.target.value)} placeholder="Type your response to the HMO's query here..." className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm mb-3 outline-none focus:ring-2 focus:ring-blue-500 min-h-20" />
                                <button
                                  onClick={resubmitOrderWithUpdates}
                                  disabled={loading || hoReplyText.trim().length === 0}
                                  className={`w-full py-3.5 rounded-xl font-black uppercase text-sm shadow-md transition-all flex justify-center items-center gap-2 ${loading || hoReplyText.trim().length === 0 ? "bg-slate-300 text-slate-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                                >
                                  {loading ? "RE-AUDITING..." : hoReplyText.trim().length === 0 ? "TYPE A REPLY TO CONTINUE" : "Update Notes & Send Reply"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button onClick={handleReviewSubmit} className="w-full py-4 rounded-2xl font-black uppercase transition-all shadow-lg bg-slate-900 text-white hover:bg-black">SUBMIT TO INSURANCE PROVIDER</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 p-6 md:p-12 flex items-center justify-center">
          <div className="max-w-2xl w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-10 text-center">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Consultant mode not wired yet</h2>
            <p className="text-sm text-slate-500 mt-2">This frontend currently supports the ordering and insurer-response workflow for non-consultant clinicians.</p>
          </div>
        </main>
      )}
    </div>
  );
}
