---
title: MediClaim AI
emoji: 🏥
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# 🏥 MediClaim: AI-Powered Risk-Adjusted Financial Settlement Engine

[![Hackathon Ready](https://img.shields.io/badge/Status-Hackathon_Ready-success)](#)
[![Interswitch API](https://img.shields.io/badge/Integration-Interswitch_API-blue)](https://developer.interswitchng.com/)
[![Gemini 2.0](https://img.shields.io/badge/Cloud_AI-Gemini_2.0_Flash-purple)](https://ai.google.dev/)
[![PubMedBERT](https://img.shields.io/badge/Offline_NLP-PubMedBERT-orange)](https://huggingface.co/pritamdeka/PubMedBERT-MNLI-MedNLI)

> **Real-time AI clinical auditing and instant HMO claim settlement at the point of care.**

## 🚀 The Vision & The Problem
In the Nigerian healthcare system, the biggest pain point for hospitals is **Days Sales Outstanding (DSO)**. Hospitals perform life-saving procedures but wait 40 to 60 days for Health Maintenance Organizations (HMOs) to pay them. Why? Because human auditors must manually review every single claim to prevent clinical upcoding and insurance fraud. Hospitals run out of cash, and the quality of patient care drops. 

**MediClaim bridges the gap between clinical intent and financial settlement.** We are not just an Electronic Health Record (EHR) system; we are a real-time risk engine. By mathematically verifying the **Logical Chain of Custody** between a patient's symptoms, the doctor's diagnosis, and the requested procedure, MediClaim protects HMO funds while ensuring hospitals maintain instant cash flow.

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

### 1. 💳 The Patient Experience (Interswitch Smart Wallet)
Patients are no longer left in the dark about their healthcare costs or forced to walk back and forth to billing departments. 
* **Zero-Friction Co-Pays:** The patient's 20% co-pay is instantly verified and deducted from their linked Interswitch Smart Wallet right at the doctor's desk.
* **Real-Time Funding:** Patients can top up their wallets directly, powered by live communication with the Interswitch API.
* **Fallback POS Paycodes:** If the patient's wallet lacks funds, the system automatically catches the deficit and generates a dynamic **Interswitch POS Paycode**. The patient simply takes this code to the cashier to pay the exact outstanding balance.

### 2. 👨‍⚕️ The Junior Doctor Experience (Dynamic SLAs)
Doctors can focus on medicine, not billing. We tied the AI's confidence score directly to the HMO Payout Service Level Agreement (SLA):
* 🟢 **> 90% Match:** Auto-approved for **Instant Payout** via Interswitch.
* 🟡 **75% - 89% Match:** Flagged for **24-Hour Settlement** (Requires Consultant Fast-Track).
* 🟠 **50% - 74% Match:** Flagged for **48-Hour Escrow**.
* 🔴 **< 50% Match (Fraud Catch):** Subject to **72-Hour HMO Audit**.

### 3. 🩺 The Consultant Dashboard & Coaching Loop
A dedicated, real-time interface for Senior Consultants to review suspicious claims. The built-in **AI Debugger** generates a bulleted list of feedback, telling junior doctors exactly what textbook criteria they missed in their notes. This acts as a real-time clinical coaching tool while allowing consultants to authorize, query, or reject funds.

### 4. 🧾 Automated Digital Receipts
Upon successful authorization, the system generates a comprehensive financial breakdown (HMO Coverage vs. Patient Co-pay) with functionality to print or instantly email the receipt to the patient.

---

## 🛠️ Tech Stack
* **Frontend:** Next.js, React, Tailwind CSS (Modern, responsive, real-time polling UI).
* **Backend:** FastAPI (Python), SQLite (Persistent Audit Ledger & Clinical Queue).
* **AI & NLP:** Google Gemini 2.0 Flash, PubMedBERT (HuggingFace Transformers).
* **Payments:** Interswitch API Integration.

---

## 💻 Running Locally (For Judges)

**1. Clone the repository**
```bash
git clone [https://github.com/wonderful-coyote/mediclaim-ai.git](https://github.com/wonderful-coyote/mediclaim-ai.git)
cd mediclaim-ai
```

**2. Setup the Backend**
*Prerequisites: Python 3.9+*
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
pip install fastapi uvicorn httpx pydantic python-dotenv google-genai transformers torch
```
*Create a `.env` file in the backend folder and add your API Keys (`GEMINI_API_KEY`, `HF_TOKEN`, `INTERSWITCH_CLIENT_ID`, `INTERSWITCH_SECRET_KEY`).*
```bash
uvicorn main:app --reload
```

**3. Setup the Frontend**
*Prerequisites: Node.js & npm*
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```

**4. Access the Terminal**
Open your browser and navigate to `http://localhost:3000`. 
* **Junior Doctor Terminal:** Select from the dropdown `Dr. Ogooluwa Isaac` (Password: `123`)
* **Senior Consultant Dashboard:** Select from the dropdown `Dr. Kunle Ade` (Password: `123`)

---

## 👥 The Builders

We built this platform from the ground up during this hackathon, iterating through complex logic flows, database structures, and AI prompt engineering to ensure it wasn't just a UI mockup, but a truly functional enterprise MVP.

* **Dr. Isaac Akinsika (Ogooluwa) | Developer & Team Lead**
  * *Role:* Architected the FastAPI backend, integrated the Gemini and Interswitch APIs, built the 2-Tier offline fallback redundancy, and developed the Next.js frontend interfaces. Bringing clinical domain expertise and a deep understanding of the Nigerian health insurance landscape.
  * *Contact:* wiz0isaac@gmail.com
* **Ekemdi Anezi | Project Manager & Researcher**
  * *Role:* Conducted deep research into Nigerian HMO bottlenecks, designed the product logic and Dynamic SLA flow, managed project execution, and ensured the MVP directly solved the hackathon's core challenges.
  * *Contact:* ekemdianezi@gmail.com

---
*Built with ❤️ for the future of African Healthcare.*
