from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import random
import uuid
import json
import os
import httpx
import sqlite3
import re 
import time
from pydantic import BaseModel 
from models import MedicalClaim
from typing import Optional, Any
from dotenv import load_dotenv
from auth_utils import generate_interswitch_auth
from google import genai
from transformers import pipeline

# Load your .env file
load_dotenv()
CLIENT_ID = os.getenv("INTERSWITCH_CLIENT_ID")
SECRET_KEY = os.getenv("INTERSWITCH_SECRET_KEY")
MERCHANT_CODE = "MX6072" 

# Configure Gemini (Tier 1)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=GEMINI_API_KEY)

HF_TOKEN = os.getenv("HF_TOKEN")

# ============================================================
# 🌟 TIER 2: PubMedBERT Raw NLI Engine
#
# We use "text-classification" (not zero-shot) because this
# model was fine-tuned on MedNLI as a 3-class classifier:
#   label_0 = entailment
#   label_1 = neutral
#   label_2 = contradiction
#
# We feed it a (premise, hypothesis) text pair and read the
# raw entailment probability directly. top_k=None forces it
# to return all 3 label scores so we can pick label_0.
# ============================================================
print("Loading Raw NLI Engine (PubMedBERT + MedNLI)...")
try:
    medical_nli = pipeline(
        "text-classification",
        model="pritamdeka/PubMedBERT-MNLI-MedNLI",
        token=HF_TOKEN,
        top_k=None
    )
    print("✅ Raw Medical NLI Engine Loaded! Dual-Matrix active.")
except Exception as e:
    print(f"⚠️ Failed to load Medical NLI model: {e}")
    medical_nli = None


app = FastAPI(title="MediClaim EHR Terminal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def init_db():
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS patients (
            patient_id TEXT PRIMARY KEY,
            wallet_balance REAL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS audit_ledger (
            claim_id TEXT PRIMARY KEY,
            patient_id TEXT,
            doctor_name TEXT,
            procedure_name TEXT,
            clinical_indication TEXT, 
            ai_score REAL,
            status TEXT,
            resolved_by TEXT,
            deducted_amount REAL,
            paycode TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT,
            amount REAL,
            txn_ref TEXT,
            type TEXT,
            description TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clinical_queue (
            id TEXT PRIMARY KEY,
            data JSON
        )
    ''')
    cursor.execute("INSERT OR IGNORE INTO patients (patient_id, wallet_balance) VALUES ('PT-1029', 50000.0)")
    cursor.execute("SELECT COUNT(*) FROM wallet_transactions WHERE patient_id = 'PT-1029'")
    if cursor.fetchone()[0] == 0:
        cursor.execute('''
            INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
            VALUES ('PT-1029', 50000.0, 'INITIAL_BAL', 'CREDIT', 'Opening Balance')
        ''')
    conn.commit()
    conn.close()
    print("✅ Database Initialized with Transaction Ledger & Clinical Queue.")

init_db()


# ============================================================
# 🌟 HELPER: Extract all 3 native scores from a single hypothesis
# ============================================================
def get_nli_scores(premise: str, hypothesis: str) -> dict:
    output = medical_nli({"text": premise, "text_pair": hypothesis})
    scores = output[0] if isinstance(output[0], list) else output
    
    entailment = next((item['score'] for item in scores if item['label'].lower() in ['label_0', 'entailment']), 0.00001)
    neutral = next((item['score'] for item in scores if item['label'].lower() in ['label_1', 'neutral']), 0.00001)
    contradiction = next((item['score'] for item in scores if item['label'].lower() in ['label_2', 'contradiction']), 0.00001)
    
    return {"E": entailment, "N": neutral, "C": contradiction}


# ============================================================
# 🌟 CORE FUNCTION: run_medical_nli_audit (Tier 2 Dual-Matrix)
# ============================================================
def run_medical_nli_audit(notes: str, procedure_name: str, diagnosis: str) -> dict:
    print("\n" + "="*60)
    print("🔍 [START] TIER 2: PubMedBERT DUAL-MATRIX AUDIT")
    print("="*60)

    if medical_nli is None:
        print("❌ ERROR: Medical NLI model unavailable.")
        return {
            "audit_score": 0.50,
            "reasoning": "[OFFLINE] Medical NLI model unavailable.",
            "tier": "FAILED"
        }

    try:
        print(f"📝 ORIGINAL NOTES:\n{notes}\n")

        blind_notes = re.split(
            r'(?i)(?:diagnos[ei]s|\bdx\b|\bddx\b|differential|assessment|\bimp\b|impression)',
            notes
        )[0].strip()

        clean_notes = blind_notes.replace('\n', ' ').replace('>', '')
        clean_notes = re.sub(r'(?i)(PC:|HPC:|Exam:|P/?C:)', ' ', clean_notes)
        clean_notes = re.sub(r'\s+', ' ', clean_notes).strip()

        print(f"🧼 CLEANED NARRATIVE (Fed to AI):\n{clean_notes}\n")

        if len(clean_notes) < 15:
            print("⚠️ WARNING: Notes too short. Fraud flag.")
            return {"audit_score": 0.15, "reasoning": "FRAUD/ERROR: No history.", "tier": "TIER_2_MEDNLI"}

        # --------------------------------------------------------
        # STEP 1: PROCEDURE GATE
        # --------------------------------------------------------
        print("⚙️ STEP 1: EVALUATING PROCEDURE")
        pos_proc_hyp = f"These clinical findings are the standard indication for {procedure_name}."
        
        proc_scores = get_nli_scores(clean_notes, pos_proc_hyp)
        pos_E_proc = proc_scores["E"]
        neg_E_proc = proc_scores["C"] # Using native contradiction!
        
        proc_score = pos_E_proc / (pos_E_proc + neg_E_proc + 0.01)

        print(f"   Pos Hyp: \"{pos_proc_hyp}\"")
        print(f"   [DEBUG] Entailment: {pos_E_proc:.6f} | Contradiction: {neg_E_proc:.6f}")
        print(f"   => Procedure Gate Score: {proc_score*100:.2f}%\n")

        # --------------------------------------------------------
        # STEP 2: DIAGNOSIS GATE
        # --------------------------------------------------------
        print("⚙️ STEP 2: EVALUATING DIAGNOSIS")
        pos_dx_hyp = f"The clinical presentation is consistent with {diagnosis}."
        
        dx_scores = get_nli_scores(clean_notes, pos_dx_hyp)
        pos_E_dx = dx_scores["E"]
        neg_E_dx = dx_scores["C"] # Using native contradiction!
        
        dx_score = pos_E_dx / (pos_E_dx + neg_E_dx + 0.01)

        print(f"   Pos Hyp: \"{pos_dx_hyp}\"")
        print(f"   [DEBUG] Entailment: {pos_E_dx:.6f} | Contradiction: {neg_E_dx:.6f}")
        print(f"   => Diagnosis Gate Score: {dx_score*100:.2f}%\n")

        # --------------------------------------------------------
        # STEP 3: VALIDATION MATRIX & AI DEBUGGER
        # --------------------------------------------------------
        final_score = min(proc_score, dx_score)

        print("⚖️ STEP 3: VALIDATION MATRIX")
        print(f"   Strict Minimum: min({proc_score*100:.1f}%, {dx_score*100:.1f}%)")
        print(f"   => FINAL MATRIX SCORE: {final_score*100:.2f}%\n")

        # 💡 THE AI TERMINAL DEBUGGER & SUGGESTION EXTRACTOR
        print("💡 AI DEBUGGER & IMPROVEMENT SUGGESTIONS:")
        suggestions_list = [] # <-- Keeping the extractor intact!
        
        # Generate human-readable reasoning (FRONTEND - DOCTOR LINGO)
        if final_score >= 0.85:
            print("   ✅ Perfect match. Notes are highly specific and logically sound.\n")
            reasoning = (
                f"[PubMedBERT] Strong Clinical Correlation ({round(final_score * 100)}%). "
                f"The documented history and physical exam strongly support the working diagnosis of '{diagnosis}' "
                f"and establish clear medical necessity for {procedure_name}."
            )
            print("🟢 RESULT: Matrix Validated — Instant Payout Tier")

        elif final_score >= 0.50:
            print("   ⚠️ Moderate match. The clinical logic is acceptable but lacks definitive proof.")
            if proc_score < 0.85:
                msg = f"Treatment Indication ({proc_score*100:.1f}%): The link to {procedure_name} is weak. Add stronger indications like lab results, disease severity, or severe exam findings."
                print(f"      Action: {msg}")
                suggestions_list.append(msg)
            if dx_score < 0.85:
                msg = f"Diagnostic Confidence ({dx_score*100:.1f}%): The '{diagnosis}' diagnosis is vague. Include textbook keywords or rule out differential diagnoses."
                print(f"      Action: {msg}")
                suggestions_list.append(msg)
            print("")
            
            reasoning = (
                f"[PubMedBERT] Equivocal Clinical Picture ({round(final_score * 100)}%). "
                f"The clinical justification is present but lacks definitive criteria. "
                f"Treatment Indication: {round(proc_score*100)}% | Diagnostic Confidence: {round(dx_score*100)}%. "
                f"Senior Consultant review required."
            )
            print("🟡 RESULT: Moderate Entailment — Escrow Tier")

        else:
            if proc_score < 0.50:
                msg = f"Treatment Indication Failed ({proc_score*100:.1f}%): Ensure the physical exam includes textbook triggers for '{procedure_name}'."
                print(f"      Action: {msg}")
                suggestions_list.append(msg)
            if dx_score < 0.50:
                msg = f"Diagnostic Confidence Failed ({dx_score*100:.1f}%): Ensure the symptoms match the diagnosis, or check for typos in the Dx field."
                print(f"      Action: {msg}")
                suggestions_list.append(msg)
            print("")
            
            if proc_score < 0.50 and dx_score >= 0.50:
                fail_reason = (
                    f"The clinical findings align with '{diagnosis}', "
                    f"but there is insufficient evidence to justify the medical necessity of {procedure_name} at this stage."
                )
            elif dx_score < 0.50 and proc_score >= 0.50:
                fail_reason = (
                    f"While {procedure_name} may be indicated for these symptoms, "
                    f"the documented clerkship does not clinically support the stated diagnosis of '{diagnosis}'."
                )
            else:
                fail_reason = (
                    f"The documented clerkship lacks the necessary clinical criteria "
                    f"to justify either the diagnosis of '{diagnosis}' or the requested {procedure_name}."
                )

            reasoning = f"[PubMedBERT] CLINICAL DISCREPANCY ({round(final_score * 100)}%). {fail_reason}"
            print(f"🔴 RESULT: Clinical Mismatch — HMO Audit Tier. {fail_reason}")

        print("="*60 + "\n")

        return {
            "audit_score": round(final_score, 2),
            "reasoning": reasoning,
            "suggestions": suggestions_list, # <-- Sending to the Consultant UI!
            "tier": "TIER_2_MEDNLI"
        }

    except Exception as e:
        print(f"❌ Medical NLI Audit Failed: {str(e)}")
        print("="*60 + "\n")
        return {
            "audit_score": 0.50,
            "reasoning": "[PubMedBERT] Audit engine error. Defaulting to manual review.",
            "tier": "FAILED"
        }


# ============================================================
# PYDANTIC MODELS
# ============================================================
class LedgerEntry(BaseModel):
    claim_id: str
    patient_id: str
    doctor_name: str
    procedure_name: str
    clinical_indication: str = "Not specified"
    ai_score: float
    status: str
    resolved_by: str
    deducted_amount: float = 0.0
    paycode: Optional[str] = None

class FundRequest(BaseModel):
    amount: float
    txn_ref: str


# ============================================================
# API ROUTES
# ============================================================

@app.post("/api/v1/ehr/audit-log")
async def save_to_ledger(entry: LedgerEntry):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO audit_ledger 
        (claim_id, patient_id, doctor_name, procedure_name, clinical_indication, ai_score, status, resolved_by, deducted_amount, paycode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (entry.claim_id, entry.patient_id, entry.doctor_name, entry.procedure_name,
          entry.clinical_indication, entry.ai_score, entry.status, entry.resolved_by,
          entry.deducted_amount, entry.paycode))

    if entry.status == "DISPATCHED" and entry.deducted_amount > 0:
        cursor.execute("SELECT COUNT(*) FROM wallet_transactions WHERE txn_ref = ?", (entry.claim_id,))
        if cursor.fetchone()[0] == 0:
            try:
                cursor.execute("UPDATE patients SET wallet_balance = wallet_balance - ? WHERE patient_id = ?",
                               (entry.deducted_amount, entry.patient_id))
                cursor.execute('''
                    INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
                    VALUES (?, ?, ?, 'DEBIT', ?)
                ''', (entry.patient_id, entry.deducted_amount, entry.claim_id, f"Co-pay: {entry.procedure_name}"))
                print(f"💰 Settlement Complete: Debited ₦{entry.deducted_amount} for {entry.procedure_name}")
            except Exception as e:
                print(f"❌ Ledger Debit Failed: {e}")
                conn.rollback()
    conn.commit()
    conn.close()
    return {"status": "success"}


@app.get("/api/v1/patient/{patient_id}")
async def get_patient_data(patient_id: str):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT wallet_balance FROM patients WHERE patient_id = ?", (patient_id,))
    patient_row = cursor.fetchone()
    balance = patient_row["wallet_balance"] if patient_row else 0.0
    cursor.execute("SELECT * FROM audit_ledger WHERE patient_id = ? ORDER BY timestamp DESC", (patient_id,))
    claims = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"balance": balance, "claims": claims}


@app.post("/api/v1/patient/{patient_id}/fund")
async def fund_wallet(patient_id: str, req: FundRequest):
    amount_in_kobo = int(req.amount * 100)
    interswitch_url = (
        f"https://qa.interswitchng.com/collections/api/v1/gettransaction.json"
        f"?merchantcode={MERCHANT_CODE}"
        f"&transactionreference={req.txn_ref}"
        f"&amount={amount_in_kobo}"
    )
    headers = generate_interswitch_auth(CLIENT_ID, SECRET_KEY, "GET", interswitch_url)

    async with httpx.AsyncClient() as client_http:
        try:
            response = await client_http.get(interswitch_url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                if data.get("ResponseCode") == "00":
                    conn = sqlite3.connect('mediclaim_enterprise.db')
                    cursor = conn.cursor()
                    cursor.execute("UPDATE patients SET wallet_balance = wallet_balance + ? WHERE patient_id = ?",
                                   (req.amount, patient_id))
                    cursor.execute('''
                        INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
                        VALUES (?, ?, ?, 'CREDIT', 'Wallet Top-up (Interswitch)')
                    ''', (patient_id, req.amount, req.txn_ref))
                    conn.commit()
                    cursor.execute("SELECT wallet_balance FROM patients WHERE patient_id = ?", (patient_id,))
                    new_balance = cursor.fetchone()[0]
                    conn.close()
                    return {"new_balance": new_balance, "status": "Verified & Funded"}
        except Exception:
            conn = sqlite3.connect('mediclaim_enterprise.db')
            cursor = conn.cursor()
            cursor.execute("UPDATE patients SET wallet_balance = wallet_balance + ? WHERE patient_id = ?",
                           (req.amount, patient_id))
            cursor.execute('''
                INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
                VALUES (?, ?, ?, 'CREDIT', 'Wallet Top-up (Demo Mode)')
            ''', (patient_id, req.amount, req.txn_ref))
            conn.commit()
            cursor.execute("SELECT wallet_balance FROM patients WHERE patient_id = ?", (patient_id,))
            new_balance = cursor.fetchone()[0]
            conn.close()
            return {"new_balance": new_balance, "status": "Funded (Demo Mode Bypass)"}


@app.get("/api/v1/clinical/dictionary")
async def get_clinical_dictionary():
    file_path = os.path.join(os.path.dirname(__file__), 'clinical_dictionary.json')
    with open(file_path, 'r') as file:
        data = json.load(file)
    return data


@app.post("/api/v1/ehr/order-procedure")
async def order_procedure(claim: MedicalClaim):
    notes = claim.clinical_notes.strip() if claim.clinical_notes else ""

    match = re.search(
        r'(?i)(?:diagnos[ei]s|\bdx\b|\bddx\b|differential|assessment|\bimp\b|impression)\s*[:\-]?\s*([^\n.]+)',
        notes
    )
    extracted_indication = match.group(1).strip() if match else f"Evaluation for {claim.procedure_name}"

    if len(notes) < 20:
        ai_score = 0.50
        # Tag system-level rejections
        ai_reasoning_msg = "[System Checker] Clinical justification is too brief to evaluate. Full history and exam summary required."
    else:
        ai_score = 0.50
        ai_reasoning_msg = ""
        ai_suggestions = []
        llm_success = False

        # ============================================================
        # 🌟 TIER 1: Gemini 2.0 Flash (Primary Cloud Auditor)
        # ============================================================
        try:
            prompt = f"""
            You are a strict Senior Medical Consultant and HMO Auditor in Nigeria. 
            A Junior Doctor has ordered the following procedure/investigation: "{claim.procedure_name}".
            They provided these clinical notes: "{notes}".
            
            Evaluate this claim based strictly on the standard clinical clerkship framework:
            1. Presenting Complaint (PC) & History of Presenting Complaint (HPC)
            2. Physical Examination Findings (General & Systemic)
            3. Final Diagnosis (Dx)

            YOUR TASK: Validate the "Logical Chain of Custody". 
            - Do the symptoms (PC/HPC) and examination findings logically lead to the stated Diagnosis?
            - If the history and exam contradict the diagnosis, heavily penalize the score (Fraud/Error catch).
            - Does the resulting clinical picture strictly justify the medical necessity of "{claim.procedure_name}"?
            
            Return ONLY a raw JSON object with no markdown formatting:
            {{
                "audit_score": <float between 0.0 and 1.0>,
                "reasoning": "<1-2 sentence clinical explanation referencing the correlation between history/exam, diagnosis, and procedure>"
            }}
            """
            response = gemini_client.models.generate_content(
                model='gemini-2.0-flash',
                contents=prompt
            )
            raw_text = response.text.replace("```json", "").replace("```", "").strip()
            audit_data = json.loads(raw_text)
            ai_score = float(audit_data.get("audit_score", 0.50))
            
            # 🌟 INJECT THE GEMINI TAG HERE
            raw_reasoning = audit_data.get("reasoning", "AI Audit completed successfully.")
            ai_reasoning_msg = f"[Gemini 2.0 Flash] {raw_reasoning}"
            
            llm_success = True
            print(f"✅ Tier 1 (Gemini) succeeded: score={ai_score}")
        except Exception as e1:
            print(f"⚠️ Tier 1 (Gemini Cloud) Failed: {e1}")

        # ============================================================
        # 🌟 TIER 2: PubMedBERT Dual-Matrix NLI (Offline Fallback)
        # ============================================================
        if not llm_success:
            print("🛡️ ACTIVATING TIER 2: PubMedBERT Medical NLI Fallback")
            nli_result = run_medical_nli_audit(notes, claim.procedure_name, extracted_indication)
            ai_score = nli_result["audit_score"]
            ai_reasoning_msg = nli_result["reasoning"]
            ai_suggestions = nli_result.get("suggestions", [])

    if ai_score >= 0.90:
        sla_tier = "Instant Payout"
    elif ai_score >= 0.75:
        sla_tier = "24-Hour Settlement"
    elif ai_score >= 0.50:
        sla_tier = "48-Hour Escrow"
    else:
        sla_tier = "72-Hour HMO Audit"

    co_pay = claim.amount * 0.20
    wallet = claim.patient.wallet_balance

    if wallet >= co_pay:
        return {
            "status": "AUTHORIZED",
            "payout_tier": sla_tier,
            "audit_score": round(ai_score, 2),
            "deducted": co_pay,
            "remaining": 0,
            "new_wallet_balance": wallet - co_pay,
            "message": "Authorized.",
            "reasoning": ai_reasoning_msg,
            "clinical_indication": extracted_indication,
            "suggestions": ai_suggestions
        }
    else:
        outstanding_amount = co_pay - wallet
        amount_in_kobo = int(outstanding_amount * 100)
        paycode_url = "https://qa.interswitchng.com/api/v1/pw/paycodes"
        headers = generate_interswitch_auth(CLIENT_ID, SECRET_KEY, "POST", paycode_url)
        payload = {
            "amount": str(amount_in_kobo),
            "frontEndId": MERCHANT_CODE,
            "transactionRef": f"PC-{uuid.uuid4().hex[:10]}"
        }
        try:
            async with httpx.AsyncClient() as client_http:
                resp = await client_http.post(paycode_url, json=payload, headers=headers)
                if resp.status_code in [200, 201]:
                    data = resp.json()
                    paycode = data.get("paycode", f"QT-{random.randint(100000, 999999)}")
                else:
                    paycode = f"QT-DEMO-{random.randint(1000, 9999)}"
        except Exception:
            paycode = f"QT-DEMO-{random.randint(1000, 9999)}"

        return {
            "status": "PARTIAL_PAYMENT",
            "payout_tier": sla_tier,
            "audit_score": round(ai_score, 2),
            "deducted": wallet,
            "remaining": outstanding_amount,
            "new_wallet_balance": 0,
            "paycode": paycode,
            "message": "Wallet exhausted. Paycode generated.",
            "reasoning": ai_reasoning_msg,
            "clinical_indication": extracted_indication,
            "suggestions": ai_suggestions
        }


# ============================================================
# 🌟 DIAGNOSTIC ENDPOINT — Verify the NLI matrix after startup
#
# curl http://127.0.0.1:8000/api/v1/debug/nli-test
#
# Expected results:
#   Case 1 (Appendicitis → Appendectomy):  score > 0.70 ✅
#   Case 2 (Stroke       → Appendectomy):  score < 0.15 ✅
#   Case 3 (Ankle Sprain → Appendectomy):  score < 0.15 ✅
#   Case 4 (Chest Pain   → ECG):           score > 0.70 ✅
# ============================================================
@app.get("/api/v1/debug/nli-test")
async def nli_diagnostic_test():
    test_cases = [
        {
            "label": "TRUE POSITIVE — Appendicitis → Appendectomy",
            "notes": "PC: 2-day history of RLQ abdominal pain, vomiting, and fever. HPC: Pain started periumbilical and migrated to RLQ. Exam: Febrile 38.5°C. Marked tenderness at McBurney's point. Positive rebound tenderness and guarding. Rovsing's sign positive. Dx: Acute Appendicitis.",
            "procedure": "Appendectomy",
            "diagnosis": "Acute Appendicitis",
            "expected": "> 0.70"
        },
        {
            "label": "FALSE POSITIVE TRAP — Stroke → Appendectomy",
            "notes": "PC: Sudden severe headache, facial droop, and left-sided weakness. HPC: Patient collapsed while eating. GCS 12/15. Exam: Left hemiplegia, NIHSS score 18. Dx: Acute Ischemic Stroke.",
            "procedure": "Appendectomy",
            "diagnosis": "Acute Ischemic Stroke",
            "expected": "< 0.15"
        },
        {
            "label": "TRUE NEGATIVE — Ankle Sprain → Appendectomy",
            "notes": "PC: Right ankle pain and swelling after a football tackle. HPC: Twisting injury. Unable to bear weight. Exam: Swelling over lateral malleolus. Anterior drawer positive. Dx: Severe Lateral Ankle Sprain.",
            "procedure": "Appendectomy",
            "diagnosis": "Severe Lateral Ankle Sprain",
            "expected": "< 0.15"
        },
        {
            "label": "TRUE POSITIVE — Chest Pain → ECG",
            "notes": "PC: Chest pain radiating to left arm with diaphoresis for 2 hours. HPC: Pain is crushing, 9/10 severity, associated with nausea. Exam: Diaphoretic, BP 90/60, HR 110. Dx: Suspected STEMI.",
            "procedure": "Electrocardiogram (ECG)",
            "diagnosis": "Suspected STEMI",
            "expected": "> 0.70"
        },
    ]

    results = []
    for case in test_cases:
        nli_result = run_medical_nli_audit(
            case["notes"], case["procedure"], case["diagnosis"]
        )
        score = nli_result["audit_score"]
        expected = case["expected"]

        if expected.startswith(">"):
            threshold = float(expected.split("> ")[1])
            passed = score > threshold
        else:
            threshold = float(expected.split("< ")[1])
            passed = score < threshold

        results.append({
            "label": case["label"],
            "procedure": case["procedure"],
            "diagnosis": case["diagnosis"],
            "score": score,
            "expected": expected,
            "status": "✅ PASS" if passed else "❌ FAIL",
            "reasoning": nli_result["reasoning"]
        })

    all_passed = all(r["status"] == "✅ PASS" for r in results)
    return {
        "model": "pritamdeka/PubMedBERT-MNLI-MedNLI",
        "step1_hypothesis": "These clinical findings are the standard indication for {procedure}.",
        "step2_hypothesis": "The clinical presentation is consistent with {diagnosis}.",
        "overall": "✅ ALL TESTS PASSED" if all_passed else "❌ SOME TESTS FAILED — check score column",
        "results": results
    }


# ============================================================
# QUEUE + TRANSACTION ROUTES (unchanged)
# ============================================================

@app.get("/api/v1/ehr/queue")
async def get_queue():
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM clinical_queue")
    rows = cursor.fetchall()
    conn.close()
    return [json.loads(row[0]) for row in rows]

@app.post("/api/v1/ehr/queue")
async def save_queue_item(claim: dict):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO clinical_queue (id, data)
        VALUES (?, ?)
    ''', (claim['id'], json.dumps(claim)))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.delete("/api/v1/ehr/queue/{claim_id}")
async def delete_queue_item(claim_id: str):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute("DELETE FROM clinical_queue WHERE id = ?", (claim_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/v1/patient/{patient_id}/transactions")
async def get_transaction_history(patient_id: str):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM wallet_transactions WHERE patient_id = ? ORDER BY timestamp DESC",
                   (patient_id,))
    transactions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return transactions