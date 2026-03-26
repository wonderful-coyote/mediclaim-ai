"use client";
import { useState, useEffect } from "react";

// 🌟 Tell TypeScript about the Interswitch Script attached to the window
declare global {
  interface Window {
    webpayCheckout: (params: PaymentParams) => void;
  }
}

// 🌟 Formal Interfaces for TypeScript Strictness
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
  doctor_name: string;
  procedure_name: string;
  ai_score: number;
  status: string;
  resolved_by: string;
  deducted_amount: number;
  paycode: string | null;
  timestamp: string;
  clinical_indication: string;
}

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

  // 🌟 Phase 6: Calculate total HMO savings (safely handles fallbacks)
  const totalSavings = claimHistory
    .filter((c) => c.status === "DISPATCHED")
    .reduce((acc, curr) => acc + (curr.deducted_amount || 0) * 4, 0);

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
    const fetchPatientData = async () => {
      try {
        const res = await fetch(
          `http://127.0.0.1:8000/api/v1/patient/${patientId}`,
        );
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance);
          setClaimHistory(data.claims);
        }
        const txRes = await fetch(
          `http://127.0.0.1:8000/api/v1/patient/${patientId}/transactions`,
        );
        if (txRes.ok) {
          const txData = await txRes.json();
          setTransactions(txData);
        }
      } catch (e) {
        console.error("DB Sync Error", e);
      }
    };
    fetchPatientData();
    const intervalId = setInterval(fetchPatientData, 3000);
    return () => clearInterval(intervalId);
  }, [isLoggedIn, patientId]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (patientId === "PT-1029" && loginPassword === "123") {
      setIsLoggedIn(true);
      setLoginError(false);
    } else {
      setLoginError(true);
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
      cust_email: "isaac@mediclaim.test",
      mode: "TEST",
      site_redirect_url: currentUrl,
      onComplete: async (response) => {
        if (!response || response.resp !== "00") {
          alert("Payment was cancelled or failed.");
          return;
        }
        try {
          const res = await fetch(
            `http://127.0.0.1:8000/api/v1/patient/${patientId}/fund`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amount: rawAmount,
                txn_ref: transactionReference,
              }),
            },
          );
          if (res.ok) {
            const data = await res.json();
            setBalance(data.new_balance);
            setIsFunding(false);
            setFundAmount("");
            alert(`Hooray! ₦${rawAmount.toLocaleString()} added & verified!`);
          } else {
            throw new Error("Backend verification failed");
          }
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

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 p-10 rounded-3xl shadow-xl">
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg transform rotate-3">
            <span className="text-white text-2xl font-black">M</span>
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-2 text-center">
            Patient Portal
          </h1>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                Hospital ID
              </label>
              <input
                type="text"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 outline-none focus:border-emerald-500 font-bold"
              />
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
                className={`w-full p-4 rounded-xl bg-slate-50 border text-slate-800 outline-none focus:border-emerald-500 ${loginError ? "border-rose-500" : "border-slate-200"}`}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-emerald-600 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg hover:bg-emerald-700 transition-colors"
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
      {/* Header */}
      <div className="w-full bg-white p-4 flex justify-between items-center px-6 shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-black">
            M
          </div>
          <span className="font-black tracking-tight text-lg text-slate-800">
            MediClaim{" "}
            <span className="font-medium text-slate-400">Patient</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs font-bold block text-slate-800">
              Ogooluwa Isaac
            </span>
            <span className="text-[9px] text-slate-400 uppercase tracking-widest block">
              {patientId}
            </span>
          </div>
          <button
            onClick={() => {
              setIsLoggedIn(false);
              setLoginPassword("");
            }}
            className="text-[10px] uppercase tracking-widest font-black text-slate-400 hover:text-rose-500"
          >
            Log Out
          </button>
        </div>
      </div>

      <main className="flex-1 p-6 md:p-12 max-w-5xl w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        {/* Left Column */}
        <div className="space-y-6 md:sticky md:top-24">
          <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200">
            <div className="flex justify-between items-center mb-6">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                My Health Wallet
              </p>
              <div className="flex flex-col items-end">
                <span className="bg-blue-50 text-blue-600 text-[8px] px-2 py-1 rounded font-black tracking-widest uppercase italic">
                  Interswitch Verified
                </span>
              </div>
            </div>

            {/* 🌟 FIXED: Flexible Height, Wrapping Text */}
            <div className="bg-slate-900 p-6 md:p-8 rounded-2xl text-white shadow-xl relative overflow-hidden flex flex-col justify-between min-h-40 h-auto">
              <div className="relative z-10 mb-4">
                <p className="text-[10px] opacity-60 uppercase font-bold tracking-wider mb-1">
                  Available Balance
                </p>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-emerald-400 break-all whitespace-normal overflow-visible leading-tight">
                  ₦{(balance ?? 0).toLocaleString()}
                </h2>
              </div>
              <div className="relative z-10 mt-auto">
                <p className="text-[9px] opacity-50 uppercase font-bold tracking-wider">
                  Virtual Account
                </p>
                <p className="text-xs md:text-sm font-mono font-bold tracking-widest">
                  9920 1029 33
                </p>
              </div>
              <div className="absolute right-0 bottom-0 w-24 h-24 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none" />
            </div>

            <button
              onClick={() => setIsFunding(!isFunding)}
              className="w-full mt-6 bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm hover:bg-black transition-all"
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
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-colors"
                >
                  Proceed to WebPay &rarr;
                </button>
              </form>
            )}
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{" "}
              Recent Activity
            </p>
            <div className="space-y-4 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
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
                    {/* 🌟 FIXED: Allows description to take available space but forces the amount to stay intact */}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-slate-800 leading-tight truncate">
                        {tx.description}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">
                        {tx.type} • {new Date(tx.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    {/* 🌟 FIXED: shrink-0 and whitespace-nowrap to prevent line breaks */}
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

        {/* Right Column */}
        <div className="md:col-span-2">
          {/* Savings Summary */}
          <div className="bg-emerald-600 rounded-3xl p-6 mb-8 text-white shadow-lg shadow-emerald-600/20 flex justify-between items-center overflow-hidden relative">
            <div className="relative z-10">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1">
                Total Healthcare Savings (80% Coverage)
              </p>
              <h3 className="text-3xl font-black">
                ₦{totalSavings.toLocaleString()}
              </h3>
              <p className="text-[9px] font-medium opacity-70 mt-1">
                Managed securely by MediClaim AI Bouncer
              </p>
            </div>
            <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-md relative z-10 text-2xl">
              🛡️
            </div>
            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
          </div>

          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">
              Medical Claims & Receipts
            </h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {claimHistory.length} Records
            </span>
          </div>

          {claimHistory.length === 0 ? (
            <div className="bg-white p-12 rounded-3xl border border-dashed border-slate-300 text-center text-slate-600 font-bold italic">
              No claims processed yet.
            </div>
          ) : (
            <div className="space-y-4">
              {claimHistory.map((claim) => (
                <div
                  key={claim.claim_id}
                  className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow relative"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">
                        HL7 System Response
                      </p>
                      <h3 className="text-lg font-black text-slate-800">
                        {claim.procedure_name}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Ordered by {claim.doctor_name} •{" "}
                        {new Date(claim.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-2 ${
                          claim.status === "DISPATCHED" && !claim.paycode
                            ? "bg-emerald-100 text-emerald-700"
                            : claim.status === "DISPATCHED" && claim.paycode
                              ? "bg-amber-100 text-amber-700"
                              : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {claim.status === "DISPATCHED" && !claim.paycode
                          ? "PAID & AUTHORIZED"
                          : claim.status === "DISPATCHED" && claim.paycode
                            ? "PENDING POS PAYMENT"
                            : "REJECTED"}
                      </span>
                      <p className="text-[10px] text-slate-400 font-mono block">
                        ID: {claim.claim_id}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between items-start mb-4 pb-4 border-b border-slate-200/60">
                    <span className="text-xs font-bold text-slate-600">
                      Clinical Indication
                    </span>
                    <span className="text-xs font-medium text-slate-800 text-right max-w-[65%] leading-relaxed bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                      {claim.clinical_indication}
                    </span>
                  </div>

                  {/* 🌟 SUCCESS: Wallet Covered Co-pay */}
                  {claim.status === "DISPATCHED" && !claim.paycode && (
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          Coverage Breakdown
                        </span>
                        <button
                          onClick={() => window.print()}
                          className="text-[9px] font-black text-emerald-600 underline uppercase"
                        >
                          Receipt
                        </button>
                      </div>

                      <div className="flex justify-between items-center pb-2 border-b border-slate-200/50">
                        <span className="text-xs text-slate-600 font-medium">
                          HMO Contribution (80%)
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          ₦{(claim.deducted_amount * 4).toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-slate-800">
                          Your Co-pay (20%)
                        </span>
                        <span className="text-sm font-black text-emerald-600">
                          ₦{(claim.deducted_amount || 0).toLocaleString()}
                        </span>
                      </div>

                      <p className="text-[9px] text-slate-400 italic text-center pt-1">
                        AI Audit Confirmed: {Math.round(claim.ai_score * 100)}%
                        Medical Necessity
                      </p>
                    </div>
                  )}

                  {/* 🌟 FALLBACK: Insufficient Funds, Paycode Generated */}
                  {claim.status === "DISPATCHED" && claim.paycode && (
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 space-y-3">
                      <div className="flex justify-between items-center pb-2 border-b border-amber-200/50">
                        <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                          Action Required: POS Payment
                        </span>
                      </div>

                      <div className="text-center py-2">
                        <p className="text-xs text-amber-800 font-medium mb-3">
                          Your wallet balance was insufficient to cover the
                          Co-pay. Please present this Paycode to the cashier:
                        </p>
                        <span className="text-xl font-mono font-black tracking-widest text-slate-800 bg-white px-4 py-2 rounded-lg border border-amber-200 shadow-sm">
                          {claim.paycode}
                        </span>
                      </div>

                      {(claim.deducted_amount || 0) > 0 && (
                        <div className="flex justify-between items-center pt-2 border-t border-amber-200/50">
                          <span className="text-xs font-black text-slate-700">
                            Partial Wallet Debit
                          </span>
                          <span className="text-sm font-black text-emerald-600">
                            ₦{claim.deducted_amount.toLocaleString()}
                          </span>
                        </div>
                      )}

                      <p className="text-[9px] text-amber-600 italic text-center pt-1">
                        AI Audit Confirmed: {Math.round(claim.ai_score * 100)}%
                        Medical Necessity
                      </p>
                    </div>
                  )}

                  {/* 🌟 REJECTED: AI or Peer Review Denial */}
                  {claim.status === "REJECTED" && (
                    <div className="bg-rose-50 rounded-xl p-4 border border-rose-100 text-xs text-rose-800 font-medium">
                      Medical necessity could not be established by AI Auditor (
                      {claim.resolved_by}). Your wallet was not charged.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}