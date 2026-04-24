---
title: MediClaim AI
emoji: 🏥
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# 🏥 MediClaim: AI-Powered Clinical Adjudication, HMO Risk Control, and Point-of-Care Settlement Engine

[![Hackathon Ready](https://img.shields.io/badge/Status-Hackathon_Ready-success)](https://mediclaim-ai-steel.vercel.app/)
[![Interswitch API](https://img.shields.io/badge/Integration-Interswitch_API-blue)](https://developer.interswitchng.com/)
[![Gemini 2.0](https://img.shields.io/badge/Cloud_AI-Gemini_2.0_Flash-purple)](https://ai.google.dev/)
[![PubMedBERT](https://img.shields.io/badge/Offline_NLP-PubMedBERT-orange)](https://huggingface.co/pritamdeka/PubMedBERT-MNLI-MedNLI)

> **Real-time AI clinical auditing, policy-aware HMO adjudication, and instant patient self-pay fallback at the point of care.**

## 🚀 The Vision & The Problem
In the Nigerian healthcare system, one of the biggest pain points for hospitals is **Days Sales Outstanding (DSO)**. Hospitals perform life-saving procedures but wait 40 to 60 days for Health Maintenance Organizations (HMOs) to pay them. Why? Because human auditors must manually review claims to prevent clinical upcoding, policy abuse, and fraud. Hospitals lose liquidity, administrators lose visibility, and patient care slows down.

At the same time, the out-of-pocket payment experience for patients is deeply broken. In many hospitals, a patient receives a paper invoice in the consulting room, walks to a centralized revenue/cashier unit, waits in another queue, pays, and walks back again before care can continue. This fragmentation wastes time, creates friction, and delays treatment.

**MediClaim bridges clinical intent, insurance rules, and financial settlement in one continuous flow.** We are not just an Electronic Health Record (EHR) interface. We are a **real-time adjudication and settlement layer** that verifies the logical chain between symptoms, diagnosis, requested procedure, policy eligibility, HMO benefit limits, patient liability, and final cash movement.

Furthermore, **MediClaim eliminates the physical payment distance for the patient.** If a claim is HMO-eligible and clinically strong, the hospital gets a fast adjudication outcome. If the patient is no longer HMO-eligible for that procedure, the system does not dead-end the encounter. It automatically pivots into a **self-pay checkout flow** using wallet deduction or a POS paycode so care can still proceed.

## 🏆 Hackathon Objectives Achieved
- [x] **Working MVP:** A functional, database-backed (SQLite) multi-portal system spanning Doctor, Patient, HMO Auditor, and CFO workflows.
- [x] **Interswitch API Integration:** Real-time wallet funding and dynamic POS paycode generation for unpaid balances.
- [x] **AI Clinical Adjudication:** Cloud-first Gemini reasoning with PubMedBERT fallback and rule-calibrated medical-necessity scoring.
- [x] **Policy + Payment Engine:** Decisions are now based on both clinical confidence and HMO policy constraints, including exhausted benefits and non-covered procedures.
- [x] **Live Demo-Ready:** Real-time polling, persistent claim history, financial dashboards, and stored review artifacts across portals.

---

## 🧠 The Architecture: Dual-Matrix AI + Policy Engine
MediClaim does not rely on human review for every claim. When a doctor submits a request, the system runs a **clinical audit** and a **policy audit** in parallel.

### Clinical Intelligence Stack
* **Tier 1 (The Cloud Reasoner): Gemini 2.0 Flash**
  Our primary reasoning engine behaves like a senior clinical auditor. It reads the submitted notes and scores the medical necessity of the requested investigation or procedure.

* **Tier 2 (The Medical Fallback): PubMedBERT + Rule-Calibrated Overlay**
  If cloud reasoning is unavailable or needs fallback support, the system switches to PubMedBERT-based Natural Language Inference and a calibration layer that evaluates:
  1. **Procedure suitability**
  2. **Diagnosis support**
  3. **Disease–procedure compatibility**
  4. **Clinical evidence completeness**

### Policy & Financial Engine
After the clinical score is produced, MediClaim applies policy logic:
- Is the procedure covered by the patient’s plan?
- Has the patient exhausted the relevant HMO benefit bucket?
- Is the request still clinically strong enough to proceed as self-pay if HMO funding is unavailable?
- Should the claim be auto-approved, sent for manual review, auto-rejected, or routed to direct patient checkout?

### Current Decision Rules
- 🟢 **90% and above + valid policy:** Auto-approved
- 🟡 **50% to 89% + valid policy:** Manual HMO review
- 🔴 **Below 50% or poor clinical notes:** Auto-rejected
- 🟠 **Clinically acceptable but policy exhausted / non-covered:** Routed to **self-pay checkout** instead of dead-ending care

This means clinical validity and HMO validity are now **separate but connected** decisions.

---

## ✨ Key Business Features & Comprehensive Functionality

### 1. 👨‍⚕️ Doctor Terminal
The doctor experience now behaves like a real point-of-care authorization console.

* **Live Clinical Order Entry:** Select a covered procedure from a patient-specific dictionary filtered by plan.
* **AI Audit at the Bedside:** Notes are audited immediately against diagnosis, procedure, and policy rules.
* **Stable Claim Identity:** A single claim now flows consistently from audit to queue to dispatch.
* **Automatic Smart Routing:**
  - High-confidence, policy-valid claims can proceed immediately.
  - Borderline claims are routed to HMO review.
  - Weak claims are rejected with reasoning.
  - Policy-exhausted but clinically valid claims are redirected into self-pay flow.
* **Resubmission Loop:** If the HMO asks for more information, the doctor can update notes, reply, and re-run the audit on the same claim.
* **Receipts at Dispatch:** Once finalized, the doctor portal generates a receipt-ready breakdown for the patient.

### 2. 🩺 HMO Auditor Workspace
The HMO dashboard is now more than a queue. It acts as a **persistent medical audit console**.

* **Manual Review Queue:** Only real manual-review claims appear here.
* **Stored HMO Claim History:** Previously adjudicated claims are retained and can be reopened later.
* **Persistent Review Artifact:** Stored records now keep:
  - clinical notes
  - AI reasoning
  - debugger suggestions
  - communication messages
  - financial snapshot
  - resolver and settlement state
* **Claim Detail Popup:** A View action opens the historical claim in a modal so past decisions can always be inspected.
* **Approvals, Denials, and Queries:** Auditors can authorize, reject, or request more information without losing claim history.

### 3. 💳 Patient Portal & Smart Wallet
Patients are no longer left in the dark about either HMO coverage or personal liability.

* **Live Wallet Balance:** Patients see available smart-wallet balance in real time.
* **Wallet Funding:** Top-up is linked to Interswitch flow.
* **Claim Timeline:** The portal shows claim status, HMO-covered amount, patient-funded amount, and remaining balance.
* **Self-Pay Continuity:** If a claim cannot use HMO benefits but is still clinically appropriate, the patient can still proceed using wallet deduction or cashier POS payment.
* **POS Paycode Display:** If there is an outstanding amount, the patient sees the exact paycode to use at cashier/POS.
* **Responsive Financial UI:** High-value totals, long labels, and long paycodes are handled more safely across breakpoints.

### 4. 🏛️ CFO & Revenue Cycle Dashboard
The CFO side now works as a genuine settlement-monitoring terminal.

* **Real-Time Financial Dashboard:** Tracks hospital liquid cash, pending HMO escrow, rejected exposure, and self-pay outstanding amounts.
* **Unified Ledger View:** HMO-funded, self-pay, rejected, and POS-clearing flows are all visible in one place.
* **Stored Claim Inspection:** Finance can open a claim record and inspect notes, AI reasoning, suggestions, and communications from the backend ledger.
* **POS Clearance Workflow:** Cashier-cleared claims update financial state more accurately.
* **Commercial Status Labelling:** Claims are categorized into HMO-funded, self-pay pending, self-pay cleared, rejected, and fully settled paths.

### 5. 🧾 Automated Financial Breakdown & Receipts
Upon dispatch or payment, MediClaim generates a clear financial breakdown showing:
- total procedure cost
- HMO-covered amount
- patient-funded amount
- outstanding balance
- paycode (if any)
- final resolver / authorization source

### 6. 🧠 AI Debugger & Clinical Coaching Loop
The built-in debugger now explains not just the score, but **why** the score was high or low.

* **Clinical Rationale:** Shows how the note supported or failed the diagnosis/procedure relationship.
* **Procedure Compatibility Checks:** Helps prevent a strong diagnosis note from incorrectly boosting the wrong procedure.
* **Improvement Suggestions:** If a claim is weak, the system tells the clinician what evidence was missing.
* **Stored Debug Record:** Those suggestions can now remain attached to the claim for later auditing.

### 7. 🛡️ Policy-Aware Benefit Control
This is one of the biggest upgrades from the original MVP.

* **Cumulative Benefit Tracking:** Repeated claims now consume the relevant HMO benefit bucket instead of letting the same benefit be reused incorrectly.
* **Benefit Exhaustion Enforcement:** Once a patient has exhausted a relevant limit, the HMO is no longer charged again.
* **Self-Pay Fallback:** Exhausted HMO benefit no longer means care stops. If clinically appropriate, the patient can pay out of pocket.
* **Hard Rejections Where Necessary:** Bad notes, low-confidence claims, or true policy failures can still be blocked automatically.

---

## 🛠️ Tech Stack
* **Frontend:** Next.js, TypeScript, Tailwind CSS
* **Backend:** FastAPI, Python, SQLite
* **AI & NLP:** Google Gemini 2.0 Flash, PubMedBERT / MedNLI fallback
* **Payments:** Interswitch WebPay, Paycode generation, wallet funding flow
* **Storage:** SQLite tables for patients, audit ledger, queue, wallet transactions, hospital wallet, and persisted HMO claim records
* **State Management:** Backend adjudication engine for approval, manual review, rejection, self-pay routing, escrow, and POS clearance

---

## 💻 Live Links & Running Locally

### 🌐 Live Demo Access
You can interact with the live production environment right now:
* **Doctor Terminal:** [[Link Here](https://mediclaim-ai-steel.vercel.app/)]
* **Patient Portal:** [[Link Here](https://mediclaim-ai-steel.vercel.app/patient)]
* **HMO Audit Workspace:** [[Link Here](https://mediclaim-ai-steel.vercel.app/hmo)]
* **CFO Dashboard:** [[Link Here](https://mediclaim-ai-steel.vercel.app/cfo)]
* **Backend API Docs:** [[Link Here](https://wonderfulcoyote-mediclaim-ai.hf.space/docs)]

### ⚙️ Run the Source Code Locally
**1. Clone the repository**
```bash
git clone https://github.com/wonderful-coyote/mediclaim-ai.git
cd mediclaim-ai
```

**2. Setup the Backend**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
pip install -r requirements.txt
```
Create a `.env` file and add:
- `GEMINI_API_KEY`
- `HF_TOKEN`
- `INTERSWITCH_CLIENT_ID`
- `INTERSWITCH_SECRET_KEY`

```bash
uvicorn main:app --reload
```

**3. Setup the Frontend**
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```

---

## 📖 How to Use This App (Test Guide)

All demo accounts currently use the password **`123`**.

### Test 1: High-Confidence HMO Approval
1. Go to the Doctor Terminal.
2. Login as a clinician and select a patient with valid coverage.
3. Pick **Appendectomy** or another covered procedure.
4. Use a strong appendicitis note, for example:
   > **PC:** 24h history of severe RLQ pain, anorexia, and nausea.  
   > **HPC:** Pain migrated from periumbilical region to RLQ.  
   > **Exam:** Temp 38.6°C. Severe tenderness at McBurney’s point. Positive Rovsing and Psoas signs. Guarding present.  
   > **Labs:** WBC 15.2 x10^9/L with neutrophilia. CRP elevated.  
   > **Imaging:** Ultrasound shows a dilated non-compressible appendix with periappendiceal fluid.  
   > **Dx:** Acute Uncomplicated Appendicitis.
5. Watch the AI score and settlement path.
6. If the patient still has valid HMO eligibility, the claim should move through the automatic route.

### Test 2: Manual HMO Review
1. Submit a note that is plausible but incomplete.
2. If the AI score lands in the **50–89%** range and policy still allows funding, the claim should go to the HMO queue.
3. Open the HMO Auditor Workspace.
4. Review, query, approve, or reject the claim.

### Test 3: Auto-Reject for Poor Clinical Support
1. Submit weak or vague notes with missing complaint / diagnosis structure.
2. The system should auto-reject instead of sending the case to manual review.
3. The reasoning and suggestions should explain why.

### Test 4: Policy Exhaustion / Self-Pay Checkout
1. Use a patient who has exhausted the applicable surgical or policy benefit.
2. Submit a clinically strong note for a procedure that would otherwise qualify.
3. The HMO should no longer fund the request.
4. Instead of dead-ending the workflow, the claim should move into **self-pay** via wallet deduction or POS paycode.
5. Confirm the patient portal and CFO dashboard both reflect that self-pay state.

### Test 5: Wallet Funding & POS Completion
1. Open the Patient Portal.
2. Login as a patient and view wallet balance and claims.
3. Fund the wallet through the Interswitch flow.
4. Use the following **Interswitch test card** for wallet funding:
   - **Card Type:** Verve
   - **Card Number:** `5061830100001895`
   - **Expiry Date:** `01/40`
   - **CVV:** `111`
   - **PIN:** `1111`
   - **OTP:** `123456`
5. If a claim still has an unpaid balance, use the POS paycode.
6. Confirm that the CFO dashboard can see and clear the payment state.

### Test 6: Historical Review Audit Trail
1. Process a claim through HMO review or settlement.
2. Open the HMO stored claims section or CFO ledger.
3. Click **View**.
4. Confirm that notes, reasoning, suggestions, communication logs, and financial state remain accessible.

---

## 🔁 Claim State Logic (Current)
A simplified view of the current engine is:

1. **Doctor submits claim**
2. **AI clinical audit runs**
3. **Policy check runs**
4. Outcome becomes one of:
   - **Auto Approved**
   - **Manual Review Required**
   - **Auto Rejected**
   - **Patient Responsible / Self-Pay**
5. **Wallet / POS / HMO ledger** update accordingly
6. **Claim history is retained** for HMO and CFO inspection

---

## 👥 The Builders

We built this platform from the ground up during the hackathon, then continued refining the underlying business logic, risk scoring, settlement rules, UI behavior, and historical auditability so that it behaves more like a true enterprise workflow than a demo mockup.

* **Dr. Isaac Akinsika | Developer & Team Lead**
  * *Role:* Architected the FastAPI backend, integrated Gemini, PubMedBERT fallback logic, Interswitch payment flow, settlement state machine, and multi-portal frontend system. Led the evolution from simple AI scoring into a clinically aware, policy-aware, self-pay-aware adjudication engine.
  * *Contact:* wiz0isaac@gmail.com
* **Anezi Ekemdi | Project Manager & Researcher**
  * *Role:* Conducted research into Nigerian HMO bottlenecks, product logic, care-flow friction, and business design. Helped shape the settlement logic, workflow requirements, and practical usability of the platform across hospital stakeholders.
  * *Contact:* ekemdianezi@gmail.com

---
*Built with ❤️ for the future of African Healthcare.*
