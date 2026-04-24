"use client";
import { useMemo, useState, useEffect } from "react";

//const API_BASE_URL = "https://wonderfulcoyote-mediclaim-ai.hf.space";
const API_BASE_URL = "http://127.0.0.1:8000";

declare global {
  interface Window {
    webpayCheckout: (params: PaymentParams) => void;
  }
}

interface InterswitchResponse {
  amount: number;
  apprCode: string;
  payRef: string;
  desc: string;
  retRef: string;
  mac: string;
  resp: string;
}

interface PaymentParams {
  merchant_code: string;
  pay_item_id: string;
  txn_ref: string;
  amount: number;
  currency: number;
  cust_email: string;
  mode: string;
  site_redirect_url: string;
  onComplete: (response: InterswitchResponse) => Promise<void>;
}

interface Transaction {
  id: number;
  description: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  timestamp: string;
}

interface DBClaim {
  claim_id: string;
  patient_id?: string;
  doctor_name: string;
  procedure_name: string;
  ai_score: number;
  status: string;
  resolved_by: string;
  deducted_amount: number;
  paycode: string | null;
  timestamp: string;
  clinical_indication: string;
  total_cost: number;
  hmo_payout: number;
  settlement_status: string;
  reasoning?: string;
  wallet_request_status?: string;
}

const getPlanDetails = (id: string) => {
  if (id === "PT-1029")
    return {
      name: "MediClaim ValuCare",
      color: "bg-emerald-500",
      badge: "Premium",
    };
  if (id === "PT-2045")
    return {
      name: "MediClaim EasyCare",
      color: "bg-indigo-500",
      badge: "Standard",
    };
  if (id === "PT-3088")
    return {
      name: "MediClaim FlexiCare",
      color: "bg-blue-500",
      badge: "Basic",
    };
  if (id === "PT-4012")
    return {
      name: "MediClaim Malaria Plan",
      color: "bg-amber-500",
      badge: "Targeted",
    };
  return {
    name: "MediClaim Smart Cover",
    color: "bg-slate-800",
    badge: "Active",
  };
};

const getClaimStage = (claim: DBClaim) => {
  const procedureCost = claim.total_cost || 0;
  const hmoCovered = claim.hmo_payout || 0;
  const coPayTotal = Math.max(procedureCost - hmoCovered, 0);
  const coPayOwed = Math.max(coPayTotal - (claim.deducted_amount || 0), 0);
  const isSelfPay =
    String(claim.settlement_status || "").startsWith("PATIENT_RESPONSIBLE") ||
    (hmoCovered <= 0 && procedureCost > 0);

  if (
    claim.status === "REJECTED" ||
    String(claim.settlement_status || "").includes("REJECTED")
  ) {
    return {
      label: "Claim Rejected",
      tone: "rose" as const,
      detail:
        claim.reasoning ||
        "Medical necessity or policy rules were not satisfied.",
      coPayOwed,
      coPayTotal,
    };
  }

  if (claim.status === "DISPATCHED" && isSelfPay && coPayOwed > 0) {
    return {
      label: "Self-Pay Checkout",
      tone: "amber" as const,
      detail:
        claim.reasoning ||
        "This procedure was clinically allowed but not payable by your HMO. Complete the patient payment to proceed.",
      coPayOwed,
      coPayTotal,
    };
  }

  if (claim.status === "DISPATCHED" && isSelfPay && coPayOwed <= 0) {
    return {
      label: "Self-Pay Cleared",
      tone: "indigo" as const,
      detail:
        claim.reasoning ||
        "This claim was handled outside HMO coverage and your patient payment has been cleared.",
      coPayOwed,
      coPayTotal,
    };
  }

  if (claim.status === "DISPATCHED" && coPayTotal === 0) {
    return {
      label: "100% Covered",
      tone: "emerald" as const,
      detail: "No out-of-pocket payment required.",
      coPayOwed,
      coPayTotal,
    };
  }

  if (claim.status === "DISPATCHED" && coPayOwed <= 0) {
    return {
      label: "Authorized & Cleared",
      tone: "emerald" as const,
      detail: "Your out-of-pocket portion has been cleared.",
      coPayOwed,
      coPayTotal,
    };
  }

  if (claim.status === "DISPATCHED" && coPayOwed > 0) {
    return {
      label: isSelfPay ? "Self-Pay Checkout" : "Pending POS Payment",
      tone: "amber" as const,
      detail: isSelfPay
        ? "HMO did not fund this claim. Patient payment is still required."
        : "Additional patient payment is still required.",
      coPayOwed,
      coPayTotal,
    };
  }

  if (claim.status === "APPROVED") {
    return {
      label: "Approved by HMO",
      tone: "indigo" as const,
      detail: "Claim approved and awaiting provider dispatch.",
      coPayOwed,
      coPayTotal,
    };
  }

  return {
    label: "Pending Review",
    tone: "slate" as const,
    detail: "Claim is still under review.",
    coPayOwed,
    coPayTotal,
  };
};

const badgeClass: Record<
  "emerald" | "amber" | "rose" | "indigo" | "slate",
  string
> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};

export default function PatientPortal() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [patientId, setPatientId] = useState("PT-1029");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(false);

  const [balance, setBalance] = useState(0);
  const [claimHistory, setClaimHistory] = useState<DBClaim[]>([]);
  const [isFunding, setIsFunding] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<DBClaim | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<Record<string, string>>({}); // <-- NEW

  const planDetails = getPlanDetails(patientId);

  const totalSavings = useMemo(
    () =>
      claimHistory
        .filter((c) => c.status === "DISPATCHED")
        .reduce((acc, curr) => acc + (curr.hmo_payout || 0), 0),
    [claimHistory],
  );

  const totalOutOfPocket = useMemo(
    () =>
      claimHistory.reduce((acc, curr) => acc + (curr.deducted_amount || 0), 0),
    [claimHistory],
  );

  const outstandingDue = useMemo(
    () =>
      claimHistory.reduce((acc, curr) => {
        const total = Math.max(
          (curr.total_cost || 0) - (curr.hmo_payout || 0),
          0,
        );
        const owed = Math.max(total - (curr.deducted_amount || 0), 0);
        return acc + owed;
      }, 0),
    [claimHistory],
  );

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://newwebpay.qa.interswitchng.com/inline-checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;

    let mounted = true;

    const fetchPatientData = async () => {
      try {
        const [patientRes, txRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/v1/patient/${patientId}`),
          fetch(`${API_BASE_URL}/api/v1/patient/${patientId}/transactions`),
        ]);

        if (patientRes.ok) {
          const data = await patientRes.json();
          if (mounted) {
            setBalance(Number(data.balance || 0));
            setClaimHistory(Array.isArray(data.claims) ? data.claims : []);
          }
        }

        if (txRes.ok) {
          const txData = await txRes.json();
          if (mounted) setTransactions(Array.isArray(txData) ? txData : []);
        }
      } catch (e) {
        console.error("DB Sync Error", e);
      }
    };

    void fetchPatientData();
    const intervalId = setInterval(() => {
      void fetchPatientData();
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [isLoggedIn, patientId]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPassword === "123") {
      setIsLoggedIn(true);
      setLoginError(false);
    } else {
      setLoginError(true);
    }
  };

  const handlePayFromWallet = async (claimId: string) => {
    setProcessingId(`pay-${claimId}`);
    
    // Clear any previous errors for this claim
    setPaymentError((prev) => {
      const next = { ...prev };
      delete next[claimId];
      return next;
    });

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/patient/pay-claim/${claimId}`, { 
        method: 'POST' 
      });
      
      // If the backend returns a 400 (Insufficient Funds)
      if (!res.ok) {
        const errorData = await res.json();
        
        // Instead of throwing an error (which triggers the Next.js red screen),
        // we directly set the UI error state and exit the function early.
        setPaymentError((prev) => ({ 
          ...prev, 
          [claimId]: errorData.detail || "Payment failed. Please check your balance." 
        }));
        setProcessingId(null); 
        return; // Stop execution here
      }
      
      // On success, keep the loading state for 2 seconds for a smooth UI transition
      setTimeout(() => setProcessingId(null), 2000);
      
    } catch (err: unknown) { // <-- FIXED: Changed from 'any' to 'unknown' to satisfy ESLint
      console.error("Payment error:", err);
      
      // Safely extract the error message for TypeScript
      const errorMessage = err instanceof Error ? err.message : "A network error occurred.";
      
      // Set the error message to display in the UI and clear the loading state
      setPaymentError((prev) => ({ ...prev, [claimId]: errorMessage }));
      setProcessingId(null); 
    }
  };

  const handleDeclineWalletRequest = async (claimId: string) => {
    setProcessingId(`decline-${claimId}`);
    try {
      await fetch(
        `${API_BASE_URL}/api/v1/patient/decline-wallet-deduction/${claimId}`,
        { method: "POST" },
      );
    } catch (err) {
      console.error("Error declining request", err);
    } finally {
      setTimeout(() => setProcessingId(null), 2000);
    }
  };

  const handleFundWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmount = parseFloat(fundAmount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    const amountInKobo = Math.round(rawAmount * 100);
    const transactionReference = `REF-${Date.now()}`;
    const currentUrl = window.location.origin + window.location.pathname;

    const paymentParams: PaymentParams = {
      merchant_code: "MX6072",
      pay_item_id: "9405967",
      txn_ref: transactionReference,
      amount: amountInKobo,
      currency: 566,
      cust_email: "patient@mediclaim.test",
      mode: "TEST",
      site_redirect_url: currentUrl,
      onComplete: async (response) => {
        if (!response || response.resp !== "00") {
          alert("Payment was cancelled or failed.");
          return;
        }
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/v1/patient/${patientId}/fund`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amount: rawAmount,
                txn_ref: transactionReference,
              }),
            },
          );
          if (!res.ok) throw new Error("Backend verification failed");
          const data = await res.json();
          setBalance(Number(data.new_balance || 0));
          setIsFunding(false);
          setFundAmount("");
          alert(`Hooray! ₦${rawAmount.toLocaleString()} added & verified!`);
        } catch (err) {
          console.error(err);
          alert("Local verification failed.");
        }
      },
    };

    if (window.webpayCheckout) {
      try {
        window.webpayCheckout(paymentParams);
      } catch (err) {
        console.error("Modal Crash:", err);
      }
    }
  };

  const formatNaira = (amount: number) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(amount || 0);

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 p-10 rounded-3xl shadow-xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="w-16 h-16 bg-slate-900 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg transform rotate-3">
            <span className="text-white text-2xl font-black">MC</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-2 text-center">
            Patient Portal
          </h1>
          <p className="text-xs text-slate-500 mb-8 text-center font-medium">
            Access your digital health wallet and claims.
          </p>
          <form onSubmit={handleLogin} className="space-y-5 relative z-10">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Hospital / Enrollee ID
              </label>
              <select
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 outline-none focus:border-slate-500 font-bold tracking-widest cursor-pointer"
              >
                <option value="PT-1029">PT-1029 (Isaac - ValuCare)</option>
                <option value="PT-2045">PT-2045 (Amaka - EasyCare)</option>
                <option value="PT-3088">PT-3088 (Bayo - FlexiCare)</option>
                <option value="PT-4012">PT-4012 (Chioma - Malaria Plan)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Secure PIN
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="PIN (123)"
                className={`w-full p-4 rounded-xl bg-slate-50 border text-slate-800 outline-none focus:border-slate-500 ${loginError ? "border-rose-500" : "border-slate-200"}`}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-black transition-colors"
            >
              Access My Portal
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      {selectedClaim && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-start gap-4 shrink-0">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Claim Record
                </p>
                <h3 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight wrap-break-word">
                  {selectedClaim.procedure_name}
                </h3>
                <p className="text-xs text-slate-500 mt-1 wrap-break-word">
                  {selectedClaim.patient_id || patientId} •{" "}
                  {selectedClaim.doctor_name} •{" "}
                  {new Date(selectedClaim.timestamp).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedClaim(null)}
                className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl"
              >
                Close
              </button>
            </div>
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 text-sm min-w-0">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  AI Score
                </p>
                <p className="text-2xl sm:text-3xl font-black text-slate-800 break-all">
                  {Math.round((selectedClaim.ai_score || 0) * 100)}%
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  Settlement
                </p>
                <p className="font-black text-slate-800 break-all whitespace-normal leading-snug">
                  {selectedClaim.settlement_status || "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  Clinical Indication
                </p>
                <p className="text-slate-700 leading-relaxed wrap-break-word whitespace-pre-wrap">
                  {selectedClaim.clinical_indication || "No indication stored."}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  AI Reasoning
                </p>
                <p className="text-slate-700 leading-relaxed wrap-break-word whitespace-pre-wrap">
                  {selectedClaim.reasoning || "No reasoning stored."}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                  Financial Snapshot
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Total Cost</span>
                    <span className="font-black text-slate-800">
                      {formatNaira(selectedClaim.total_cost || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">HMO Payout</span>
                    <span className="font-black text-indigo-600">
                      {formatNaira(selectedClaim.hmo_payout || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Patient Deducted</span>
                    <span className="font-black text-emerald-600">
                      {formatNaira(selectedClaim.deducted_amount || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Paycode</span>
                    <span className="font-black text-slate-800 break-all text-right leading-snug">
                      {selectedClaim.paycode || "-"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full bg-white p-4 flex justify-between items-center px-6 shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white font-black shrink-0">
            M
          </div>
          <span className="font-black tracking-tight text-lg text-slate-800 wrap-break-word">
            MediClaim{" "}
            <span className="font-medium text-slate-400">Patient</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs font-bold block text-slate-800">
              Enrollee Account
            </span>
            <span className="text-[9px] text-slate-400 uppercase tracking-widest block font-bold">
              {patientId}
            </span>
          </div>
          <button
            onClick={() => {
              setIsLoggedIn(false);
              setLoginPassword("");
            }}
            className="text-[10px] uppercase tracking-widest font-black text-slate-400 hover:text-rose-500 bg-slate-100 px-3 py-1.5 rounded-lg"
          >
            Log Out
          </button>
        </div>
      </div>

      <main className="flex-1 p-6 md:p-12 max-w-300 w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        <div className="space-y-6 md:sticky md:top-24">
          <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200 relative overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                My Smart Card
              </p>
              <div className="flex flex-col items-end">
                <span className="bg-blue-50 text-blue-600 border border-blue-100 text-[8px] px-2 py-1 rounded font-black tracking-widest uppercase">
                  Interswitch Linked
                </span>
              </div>
            </div>

            <div
              className={`${planDetails.color} p-6 md:p-8 rounded-2xl text-white shadow-xl relative overflow-hidden flex flex-col justify-between min-h-48 h-auto transition-colors duration-500 min-w-0`}
            >
              <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
              <div className="relative z-10 flex justify-between items-start mb-6">
                <div>
                  <p className="text-[10px] opacity-80 uppercase font-black tracking-widest mb-1">
                    Active Plan
                  </p>
                  <p className="text-sm font-black tracking-tight wrap-break-word">
                    {planDetails.name}
                  </p>
                </div>
                <span className="bg-white/20 px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest backdrop-blur-sm border border-white/20">
                  {planDetails.badge}
                </span>
              </div>
              <div className="relative z-10 mb-4">
                <p className="text-[10px] opacity-80 uppercase font-black tracking-widest mb-1">
                  Available Balance
                </p>
                <h2 className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-black text-white break-all leading-none max-w-full">
                  ₦{(balance ?? 0).toLocaleString()}
                </h2>
              </div>
              <div className="relative z-10 mt-auto pt-4 border-t border-white/20 flex justify-between items-end">
                <div>
                  <p className="text-[8px] opacity-70 uppercase font-black tracking-widest mb-0.5">
                    Virtual Account
                  </p>
                  <p className="text-xs sm:text-sm font-mono font-bold tracking-widest opacity-90 break-all">
                    9920 {patientId.slice(3, 7)} 33
                  </p>
                </div>
                <div className="w-8 h-6 bg-white/20 rounded-md border border-white/30" />
              </div>
            </div>

            <button
              onClick={() => setIsFunding(!isFunding)}
              className="w-full mt-6 bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all shadow-md"
            >
              + Fund Wallet
            </button>

            {isFunding && (
              <form
                onSubmit={handleFundWallet}
                className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl animate-in fade-in"
              >
                <input
                  type="number"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  placeholder="Amount (₦)"
                  className="w-full p-3 rounded-lg border bg-white text-sm mb-3 outline-none focus:border-blue-500 font-bold"
                  required
                />
                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-colors shadow-md"
                >
                  Proceed to WebPay →
                </button>
              </form>
            )}
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Recent Activity
            </p>
            <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
              {transactions.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-4">
                  No activity yet.
                </p>
              ) : (
                transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex justify-between items-start gap-3 pb-3 border-b border-slate-50 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-slate-800 leading-tight truncate">
                        {tx.description}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter mt-1">
                        {tx.type} •{" "}
                        {new Date(tx.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <div
                      className={`text-sm font-black shrink-0 whitespace-nowrap ${tx.type === "CREDIT" ? "text-emerald-500" : "text-rose-500"}`}
                    >
                      {tx.type === "CREDIT" ? "+" : "-"} ₦
                      {tx.amount.toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 items-stretch">
            <div className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-w-0">
              <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2 flex items-center gap-2">
                  <span className="text-base">🛡️</span>Total Healthcare Savings
                </p>
                <h3 className="text-2xl sm:text-3xl lg:text-4xl xl:text-[2.75rem] font-black tracking-tighter break-all leading-none max-w-full">
                  ₦{totalSavings.toLocaleString()}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">
                  Costs covered by your active HMO plan
                </p>
              </div>
            </div>
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Out-of-Pocket Paid
              </p>
              <h3 className="text-2xl sm:text-3xl lg:text-4xl xl:text-[2.75rem] font-black tracking-tighter text-slate-800 break-all leading-none max-w-full">
                ₦{totalOutOfPocket.toLocaleString()}
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-3">
                Patient-funded amount already cleared
              </p>
            </div>
            <div className="bg-amber-50 rounded-3xl p-6 sm:p-8 border border-amber-200 shadow-sm min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">
                Outstanding Balance
              </p>
              <h3 className="text-2xl sm:text-3xl lg:text-4xl xl:text-[2.75rem] font-black tracking-tighter text-rose-600 break-all leading-none max-w-full">
                ₦{outstandingDue.toLocaleString()}
              </h3>
              <p className="text-[10px] font-bold text-amber-700/70 uppercase tracking-widest mt-3">
                Still due on pending POS / self-pay claims
              </p>
            </div>
          </div>

          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">
              Medical Claims & Receipts
            </h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white px-3 py-1 rounded-lg border border-slate-200 shadow-sm">
              {claimHistory.length} Records
            </span>
          </div>

          {claimHistory.length === 0 ? (
            <div className="bg-white p-16 rounded-3xl border border-dashed border-slate-300 text-center shadow-sm">
              <div className="text-4xl mb-4 opacity-50">📂</div>
              <p className="text-slate-600 font-bold">
                No claims processed yet.
              </p>
              <p className="text-xs text-slate-400 mt-2">
                When a doctor submits a claim, your AI audit results and
                receipts will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {claimHistory.map((claim) => {
                const stage = getClaimStage(claim);
                return (
                  <div
                    key={claim.claim_id}
                    className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-md transition-all relative overflow-hidden min-w-0"
                  >
                    <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-6 gap-4">
                      <div>
                        <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">
                          HL7 System Response
                        </p>
                        <h3 className="text-xl font-black text-slate-800 tracking-tight wrap-break-word">
                          {claim.procedure_name}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 font-medium wrap-break-word">
                          Ordered by{" "}
                          <span className="font-bold text-slate-700">
                            {claim.doctor_name}
                          </span>{" "}
                          • {new Date(claim.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-left md:text-right">
                        <span
                          className={`inline-block px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest mb-2 shadow-sm border max-w-full wrap-break-word ${badgeClass[stage.tone]}`}
                        >
                          {stage.label}
                        </span>
                        <p className="text-[10px] text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded inline-block md:block md:bg-transparent md:p-0 break-all">
                          ID: {claim.claim_id.substring(0, 12)}...
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 mb-5">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                        Clinical Indication
                      </span>
                      <span className="text-sm font-medium text-slate-700 leading-relaxed italic wrap-break-word whitespace-pre-wrap">
                        “{claim.clinical_indication || "No indication stored."}”
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Total Cost
                        </p>
                        <p className="text-base sm:text-lg font-black text-slate-800 break-all">
                          {formatNaira(claim.total_cost || 0)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          HMO Covered
                        </p>
                        <p className="text-base sm:text-lg font-black text-indigo-600 break-all">
                          {formatNaira(claim.hmo_payout || 0)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          You Paid
                        </p>
                        <p className="text-base sm:text-lg font-black text-emerald-600 break-all">
                          {formatNaira(claim.deducted_amount || 0)}
                        </p>
                      </div>
                    </div>

                    {stage.coPayOwed > 0 && claim.paycode && (
                      <div className="bg-amber-50 rounded-xl p-5 border border-amber-200 space-y-3 shadow-sm mb-5">
                        <div className="flex justify-between items-start gap-3">
                          <span className="text-[10px] font-black text-amber-800 uppercase tracking-widest">
                            Outstanding Balance
                          </span>
                          <span className="text-base sm:text-lg font-black text-rose-600 break-all text-right">
                            {formatNaira(stage.coPayOwed)}
                          </span>
                        </div>

                        {/* Handle the CFO's Request */}
                        {claim.wallet_request_status === "REQUESTED" ? (
                          <div className="text-center py-4 bg-amber-100 rounded-lg border border-amber-300 shadow-sm mt-2 animate-in fade-in">
                            <p className="text-[10px] text-amber-900 font-black uppercase tracking-widest mb-3 animate-pulse">
                              Hospital Requesting Wallet Payment
                            </p>
                            <div className="flex gap-2 justify-center px-4">
                              <button
                                onClick={() =>
                                  handleDeclineWalletRequest(claim.claim_id)
                                }
                                disabled={processingId !== null}
                                className="flex-1 bg-white border border-rose-200 hover:bg-rose-50 disabled:bg-slate-100 disabled:text-slate-400 text-rose-700 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-sm"
                              >
                                {processingId === `decline-${claim.claim_id}`
                                  ? "Declining..."
                                  : "Decline"}
                              </button>
                              <button
                                onClick={() =>
                                  handlePayFromWallet(claim.claim_id)
                                }
                                disabled={processingId !== null}
                                className="flex-[1.5] bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-md"
                              >
                                {processingId === `pay-${claim.claim_id}`
                                  ? "Processing..."
                                  : `Approve ₦${stage.coPayOwed.toLocaleString()}`}
                              </button>
                            </div>

                            {paymentError[claim.claim_id] && (
                              <div className="mt-3 px-4 animate-in slide-in-from-top-2">
                                <p className="text-[10px] text-rose-600 font-black bg-rose-50 py-2 rounded-lg border border-rose-200 uppercase tracking-widest shadow-inner">
                                  ⚠️ {paymentError[claim.claim_id]}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : balance >= stage.coPayOwed ? (
                          // Existing Proactive Patient Payment
                          <div className="text-center py-4 bg-emerald-50 rounded-lg border border-emerald-200 shadow-sm mt-2">
                            <p className="text-[10px] text-emerald-800 font-black uppercase tracking-widest mb-3">
                              Wallet Funds Available
                            </p>
                            <button
                              onClick={() =>
                                handlePayFromWallet(claim.claim_id)
                              }
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-md"
                            >
                              Proactively Pay ₦
                              {stage.coPayOwed.toLocaleString()}
                            </button>
                          </div>
                        ) : (
                          // Existing POS Fallback
                          <div className="text-center py-3 bg-white rounded-lg border border-amber-200 shadow-inner">
                            <p className="text-[10px] text-amber-800 font-black uppercase tracking-widest mb-2">
                              {(claim.hmo_payout || 0) <= 0
                                ? "Insufficient Wallet Balance. Pay via Cashier."
                                : "Give this code to the Cashier to pay via POS"}
                            </p>
                            <span className="text-lg sm:text-2xl font-mono font-black tracking-widest text-slate-800 break-all">
                              {claim.paycode}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 pt-3 border-t border-slate-100">
                      <p className="text-xs text-slate-500 leading-relaxed md:max-w-[70%] wrap-break-word">
                        {stage.detail}
                      </p>
                      <div className="flex items-center gap-3 flex-wrap justify-end">
                        {claim.status !== "REJECTED" && (
                          <span className="text-[9px] bg-slate-100 text-slate-500 px-3 py-1 rounded-full font-bold uppercase tracking-widest border border-slate-200">
                            AI Audit Verified:{" "}
                            {Math.round((claim.ai_score || 0) * 100)}%
                          </span>
                        )}
                        <button
                          onClick={() => setSelectedClaim(claim)}
                          className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black shrink-0"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
