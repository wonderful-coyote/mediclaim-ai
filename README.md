---
title: MediClaim AI
emoji: 🏥
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# 🏥 MediClaim: AI-Powered Risk-Adjusted Financial Settlement Engine

[![Hackathon Ready](https://img.shields.io/badge/Status-Hackathon_Ready-success)](https://mediclaim-ai-steel.vercel.app/)
[![Interswitch API](https://img.shields.io/badge/Integration-Interswitch_API-blue)](https://developer.interswitchng.com/)
[![Gemini 2.0](https://img.shields.io/badge/Cloud_AI-Gemini_2.0_Flash-purple)](https://ai.google.dev/)
[![PubMedBERT](https://img.shields.io/badge/Offline_NLP-PubMedBERT-orange)](https://huggingface.co/pritamdeka/PubMedBERT-MNLI-MedNLI)

> **Real-time AI clinical auditing and instant HMO claim settlement at the point of care.**

## 🚀 The Vision & The Problem
In the Nigerian healthcare system, the biggest pain point for hospitals is **Days Sales Outstanding (DSO)**. Hospitals perform life-saving procedures but wait 40 to 60 days for Health Maintenance Organizations (HMOs) to pay them. Why? Because human auditors must manually review every single claim to prevent clinical upcoding and insurance fraud. Hospitals run out of cash, and the quality of patient care drops. 

Simultaneously, the out-of-pocket payment experience for patients is deeply broken. In standard government and public hospitals across Nigeria, patients are forced to navigate a fragmented, physically exhausting billing system. A patient receives a paper invoice in the consulting room, walks to a centralized revenue/cashier unit (often in a completely different wing or building), endures a long queue just to make a payment, and then walks all the way back to the doctor or pharmacy to receive care. This physical distance and redundant queuing wastes critical time, especially during emergencies.

**MediClaim bridges the gap between clinical intent and financial settlement.** We are not just an Electronic Health Record (EHR) system; we are a real-time risk and payment engine. By mathematically verifying the **Logical Chain of Custody** between a patient's symptoms, the doctor's diagnosis, and the requested procedure, MediClaim protects HMO funds while ensuring hospitals maintain instant cash flow. 

Furthermore, **MediClaim eliminates the physical payment distance for the patient.** Out-of-pocket co-pays are instantly deducted right at the doctor's desk via the Interswitch Smart Wallet. Even if the wallet is unfunded, the system instantly generates a dynamic POS Paycode, entirely cutting out the need for patients to carry paper invoices back and forth across the hospital.

## 🏆 Hackathon Objectives Achieved
- [x] **Working MVP:** A fully functional, database-backed (SQLite) end-to-end flow from Junior Doctor order to Consultant Peer Review, to final wallet deduction. 
- [x] **Interswitch API Integration:** Successfully integrated for real-time patient wallet funding and dynamic POS Paycode generation for outstanding balances.
- [x] **Solves a Real Problem:** Sits perfectly at the intersection of **Health-Tech and Fintech**, eliminating HMO fraud while providing instant liquidity to hospitals.
- [x] **Live Demo-Ready:** Features an incredibly fast UI, a 2-Tier AI Bouncer for presentation resilience, and real-time database polling.

---

## 🧠 The Architecture: Dual-Matrix AI Validation
MediClaim doesn't rely on human auditors for every claim. When a Junior Doctor submits a clinical clerkship, the system initiates the **Blind Diagnosis Protocol**. The final diagnosis is stripped away, forcing the AI to evaluate the raw clinical evidence (Presenting Complaints and Physical Exam) independently.

* **Tier 1 (The Cloud Genius): Gemini 2.0 Flash Auditor** Our primary reasoning engine acts as a Senior Medical Consultant, reading the clerkship via cloud API and scoring the logical necessity of the ordered procedure.
* **Tier 2 (The Offline Tank): PubMedBERT Dual-Matrix**
  If the internet fails or cloud quotas are exceeded, the system instantly falls back to a locally hosted NLP model trained on millions of medical abstracts (MedNLI). It runs two simultaneous mathematical gates:
  1. **Treatment Indication Gate:** Do the raw symptoms justify the procedure?
  2. **Diagnostic Confidence Gate:** Do the raw symptoms align with the written diagnosis?

If the claim passes, the Interswitch payment gateway is triggered. If it fails, it is flagged for Consultant review with specific, actionable AI coaching suggestions.

---

## ✨ Key Business Features & Comprehensive Functionality

### 1. 🏛️ Hospital CFO & Financial Engine (New)
* **Real-Time Financial Dashboard:** A secure administrative terminal for tracking **Available Balance (Settled Cash)** and **Pending Escrow (Unsettled HMO Payouts)**.
* **HMO Escrow State Machine:** Advanced backend logic that manages funds based on AI confidence. High-scoring claims are instantly settled, while moderate scores are trapped in Escrow until authorized by a Senior Consultant.
* **Interswitch Co-pay Automation:** Automatically deducts 20% patient co-pays via Interswitch WebPay, which are then instantly credited to the hospital's available balance to ensure immediate liquidity.

### 2. 💳 The Patient Experience (Interswitch Smart Wallet)
Patients are no longer left in the dark about their healthcare costs or forced to walk back and forth to billing departments. 
* **Zero-Friction Co-Pays:** The patient's 20% co-pay is instantly verified and deducted from their linked Interswitch Smart Wallet right at the doctor's desk.
* **Real-Time Funding:** Patients can top up their wallets directly, powered by live communication with the Interswitch API.
* **Fallback POS Paycodes:** If the patient's wallet lacks funds, the system automatically catches the deficit and generates a dynamic **Interswitch POS Paycode**. The patient simply takes this code to the cashier to pay the exact outstanding balance.

### 3. 👨‍⚕️ The Junior Doctor Experience (Dynamic SLAs)
Doctors can focus on medicine, not billing. We tied the AI's confidence score directly to the HMO Payout Service Level Agreement (SLA):
* 🟢 **> 90% Match:** Auto-approved for **Instant Payout** via Interswitch.
* 🟡 **75% - 89% Match:** Flagged for **24-Hour Settlement** (Requires Consultant Fast-Track).
* 🟠 **50% - 74% Match:** Flagged for **48-Hour Escrow**.
* 🔴 **< 50% Match (Fraud Catch):** Subject to **72-Hour HMO Audit**.

### 4. 🩺 The Consultant Dashboard & Coaching Loop
A dedicated, real-time interface for Senior Consultants to review suspicious claims. The built-in **AI Debugger** generates a bulleted list of feedback, telling junior doctors exactly what textbook criteria they missed in their notes. This acts as a real-time clinical coaching tool while allowing consultants to authorize, query, or reject funds.

### 5. 🧾 Automated Digital Receipts
Upon successful authorization, the system generates a comprehensive financial breakdown (HMO Coverage vs. Patient Co-pay) with functionality to print or instantly email the receipt to the patient.

---

## 🛠️ Tech Stack
* **Frontend:** Next.js (TypeScript), Tailwind CSS (Deployed on Vercel).
* **Backend:** FastAPI (Python), Docker, SQLite (Deployed on Hugging Face Spaces).
* **AI & NLP:** Google Gemini 2.0 Flash, PubMedBERT (HuggingFace Transformers).
* **Payments:** Interswitch WebPay & Paycode API Integration.
* **State Management:** Backend Financial State Machine for Escrow/Settlement transitions.

---

## 💻 Live Links & Running Locally

### 🌐 Live Demo Access
You can interact with the live production environment right now:
* **Doctor Terminal:** [[Link Here](https://mediclaim-ai-steel.vercel.app/)]
* **Patient Wallet:** [[Link Here](https://mediclaim-ai-steel.vercel.app/patient)]
* * **CFO Dashboard:** [[Link Here](https://mediclaim-ai-steel.vercel.app/admin)]
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
*Create a `.env` file and add: `GEMINI_API_KEY`, `HF_TOKEN`, `INTERSWITCH_CLIENT_ID`, `INTERSWITCH_SECRET_KEY`.*
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

We designed this MVP to be fully interactive. All User IDs are conveniently located in the login dropdowns, and the password for all accounts is **`123`**. 

To experience the full power of the Dual-Matrix AI and the Interswitch payment loop, please follow these testing scenarios:

### Test 1: The AI Medical Auditor (Doctor Flow)
1. Go to the Live Doctor Terminal: [[Link Here](https://mediclaim-ai-steel.vercel.app/)]
2. Select a Doctor ID from the dropdown and enter password `123`.
3. Notice the patient's Interswitch Card Balance is visible right at the point of care.
4. **Create a Claim:** Select a test (e.g., Ultrasound or Appendectomy) and paste these exact clinical notes into the system to simulate a valid claim:
   > **PC:** 2-day history of right lower quadrant (RLQ) abdominal pain, vomiting, and fever. 
   > **HPC:** Pain started periumbilical and migrated to the RLQ after 6 hours. Vomited 3 times, non-bilious. No diarrhea. 
   > **Exam:** Patient is acutely ill-looking and febrile (Temp 38.5°C). Abdomen is flat but does not move with respiration. Marked tenderness at McBurney's point. Positive rebound tenderness and involuntary guarding. Rovsing's sign is positive. 
   > **Dx:** Acute Appendicitis.
5. **Submit & Watch the AI:** The AI will instantly audit the logical chain of custody and assign an SLA tier:
   * 🟢 **> 90% Match:** Auto-approved for Instant Payout.
   * 🟡 **75% - 89% Match:** Flagged for 24-Hour Settlement.
   * 🟠 **50% - 74% Match:** Flagged for 48-Hour Escrow.
   * 🔴 **< 50% Match:** Fraud Catch (Subject to 72-Hour Audit).

### Test 2: The Interswitch Payment Gateway (Patient Flow)
1. Navigate to the Patient Portal: [[Link Here](https://mediclaim-ai-steel.vercel.app/patient)]
2. Select Patient ID **`PT-1029`** from the dropdown and enter password `123`.
3. View the real-time financial dashboard to track HMO claims and wallet balances.
4. Click **"Fund Wallet"** to interact with the live Interswitch API.
5. Use this official Interswitch Test Card to successfully complete a transaction:
   * **Card Brand:** Verve
   * **Card Number:** `5061050254756707864`
   * **Expiry:** `06/26`
   * **CVV:** `111`
   * **PIN:** `1111`
   * **OTP:** `123456`

### Test 3: The Escalation Loop & Live Chat (Consultant Flow)
This flow is triggered automatically if the Junior Doctor's AI score in Test 1 is below 90%. 

1. **Trigger the Review (Junior Doctor Side):** After receiving a sub-90% AI score, click the **"Send for Review"** button and select a specific Senior Consultant to route the claim to them. 
2. **Login as the Consultant:** Return to the main login screen. Select the *exact same Senior Consultant ID* that was chosen in the previous step, and enter password `123`.
3. **The Clinical Query (Live Chat):** Open the flagged investigation request. Use the built-in **Chat Box** to send a direct query to the Junior Doctor, asking for better clinical justification (the Junior Doctor must provide a response to proceed).
4. **Final Authorization:** After reviewing the chat history and the AI's initial risk score, click **Authorize** or **Deny** to make the final clinical decision and either deduct or block the Co-pay funds.

### Test 4: The CFO Financial Terminal (Admin Flow)
Navigate to the Admin Portal: [[Link Here](https://mediclaim-ai-steel.vercel.app/admin)]

Login with ID CFO-001 and password 123.

Real-time Tracking: Watch the Available Balance increase by 20% (Patient Co-pay) instantly when a doctor orders a test, and watch the 80% HMO Payout enter Pending Escrow.

Escrow Release: Once a Consultant authorizes a sub-90% claim, watch the funds move from Escrow to Available Balance in real-time.

## 👥 The Builders

We built this platform from the ground up during this hackathon, iterating through complex logic flows, database structures, cloud deployments, and AI prompt engineering to ensure it wasn't just a UI mockup, but a truly functional enterprise MVP.

* **Dr. Isaac Akinsika | Developer & Team Lead**
  * *Role:* Architected the decoupled FastAPI backend, integrated the Gemini and Interswitch APIs, built the 2-Tier offline fallback redundancy, deployed the Docker infrastructure, and developed the Next.js frontend interfaces. Brings deep clinical domain expertise, alongside extensive research in healthcare financing and the Nigerian health insurance landscape.
  * *Contact:* wiz0isaac@gmail.com
* **Anezi Ekemdi | Project Manager & Researcher**
  * *Role:* Conducted deep research into Nigerian HMO bottlenecks, designed the product logic and Dynamic SLA flow, managed project execution, and ensured the MVP directly solved the hackathon's core challenges.
  * *Contact:* ekemdianezi@gmail.com

---
*Built with ❤️ for the future of African Healthcare.*
