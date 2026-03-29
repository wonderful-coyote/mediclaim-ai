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
    
    # 🆕 UPDATED: Added Financial State Machine Columns to Ledger
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
            total_cost REAL,
            hmo_payout REAL,
            settlement_status TEXT,
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
    
    # 🆕 NEW: Hospital Master Wallet Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS hospital_wallet (
            id TEXT PRIMARY KEY,
            available_balance REAL,
            pending_escrow REAL
        )
    ''')
    
    # 🆕 Initialize the Hospital Wallet with Demo Cash
    cursor.execute("INSERT OR IGNORE INTO hospital_wallet (id, available_balance, pending_escrow) VALUES ('HW-001', 1250000.0, 0.0)")

    cursor.execute("INSERT OR IGNORE INTO patients (patient_id, wallet_balance) VALUES ('PT-1029', 50000.0)")
    cursor.execute("SELECT COUNT(*) FROM wallet_transactions WHERE patient_id = 'PT-1029'")
    if cursor.fetchone()[0] == 0:
        cursor.execute('''
            INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
            VALUES ('PT-1029', 50000.0, 'INITIAL_BAL', 'CREDIT', 'Opening Balance')
        ''')
    conn.commit()
    conn.close()
    print("✅ Database Initialized with Transaction Ledger, Clinical Queue & Hospital Wallet.")

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
    # [Unchanged: Your excellent NLI Logic remains exactly the same]
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

        print("⚙️ STEP 1: EVALUATING PROCEDURE")
        pos_proc_hyp = f"These clinical findings are the standard indication for {procedure_name}."
        proc_scores = get_nli_scores(clean_notes, pos_proc_hyp)
        pos_E_proc = proc_scores["E"]
        neg_E_proc = proc_scores["C"] 
        proc_score = pos_E_proc / (pos_E_proc + neg_E_proc + 0.01)

        print("⚙️ STEP 2: EVALUATING DIAGNOSIS")
        pos_dx_hyp = f"The clinical presentation is consistent with {diagnosis}."
        dx_scores = get_nli_scores(clean_notes, pos_dx_hyp)
        pos_E_dx = dx_scores["E"]
        neg_E_dx = dx_scores["C"] 
        dx_score = pos_E_dx / (pos_E_dx + neg_E_dx + 0.01)

        final_score = min(proc_score, dx_score)

        print("⚖️ STEP 3: VALIDATION MATRIX")
        print("💡 AI DEBUGGER & IMPROVEMENT SUGGESTIONS:")
        suggestions_list = [] 
        
        if final_score >= 0.85:
            reasoning = (
                f"[PubMedBERT] Strong Clinical Correlation ({round(final_score * 100)}%). "
                f"The documented history and physical exam strongly support the working diagnosis of '{diagnosis}' "
                f"and establish clear medical necessity for {procedure_name}."
            )
        elif final_score >= 0.50:
            if proc_score < 0.85:
                suggestions_list.append(f"Treatment Indication ({proc_score*100:.1f}%): The link to {procedure_name} is weak. Add stronger indications like lab results, disease severity, or severe exam findings.")
            if dx_score < 0.85:
                suggestions_list.append(f"Diagnostic Confidence ({dx_score*100:.1f}%): The '{diagnosis}' diagnosis is vague. Include textbook keywords or rule out differential diagnoses.")
            reasoning = (
                f"[PubMedBERT] Equivocal Clinical Picture ({round(final_score * 100)}%). "
                f"Treatment Indication: {round(proc_score*100)}% | Diagnostic Confidence: {round(dx_score*100)}%. "
                f"Senior Consultant review required."
            )
        else:
            if proc_score < 0.50:
                suggestions_list.append(f"Treatment Indication Failed ({proc_score*100:.1f}%): Ensure the physical exam includes textbook triggers for '{procedure_name}'.")
            if dx_score < 0.50:
                suggestions_list.append(f"Diagnostic Confidence Failed ({dx_score*100:.1f}%): Ensure the symptoms match the diagnosis, or check for typos in the Dx field.")
            
            if proc_score < 0.50 and dx_score >= 0.50:
                fail_reason = f"The clinical findings align with '{diagnosis}', but there is insufficient evidence to justify the medical necessity of {procedure_name} at this stage."
            elif dx_score < 0.50 and proc_score >= 0.50:
                fail_reason = f"While {procedure_name} may be indicated for these symptoms, the documented clerkship does not clinically support the stated diagnosis of '{diagnosis}'."
            else:
                fail_reason = f"The documented clerkship lacks the necessary clinical criteria to justify either the diagnosis of '{diagnosis}' or the requested {procedure_name}."

            reasoning = f"[PubMedBERT] CLINICAL DISCREPANCY ({round(final_score * 100)}%). {fail_reason}"

        print("="*60 + "\n")

        return {
            "audit_score": round(final_score, 2),
            "reasoning": reasoning,
            "suggestions": suggestions_list, 
            "tier": "TIER_2_MEDNLI"
        }

    except Exception as e:
        print(f"❌ Medical NLI Audit Failed: {str(e)}")
        return {
            "audit_score": 0.50,
            "reasoning": "[PubMedBERT] Audit engine error. Defaulting to manual review.",
            "tier": "FAILED"
        }


# ============================================================
# PYDANTIC MODELS (🆕 Updated with Financial Columns)
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
    
    # 🆕 New Financial Fields
    total_cost: float = 50000.0
    hmo_payout: float = 40000.0
    settlement_status: str = "PENDING_AI_AUDIT"

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
    
    # Check if this claim is new or existing
    cursor.execute("SELECT settlement_status FROM audit_ledger WHERE claim_id = ?", (entry.claim_id,))
    existing_claim = cursor.fetchone()
    
    if not existing_claim:
        # --- 1. BRAND NEW CLAIM MATH ---
        if entry.deducted_amount > 0:
            cursor.execute("UPDATE hospital_wallet SET available_balance = available_balance + ? WHERE id = 'HW-001'", (entry.deducted_amount,))
            
        if entry.settlement_status in ["INSTANT_SETTLED", "SETTLED"]:
            cursor.execute("UPDATE hospital_wallet SET available_balance = available_balance + ? WHERE id = 'HW-001'", (entry.hmo_payout,))
        elif entry.settlement_status in ["PENDING_CONSULTANT", "PENDING_TIMER"]:
            cursor.execute("UPDATE hospital_wallet SET pending_escrow = pending_escrow + ? WHERE id = 'HW-001'", (entry.hmo_payout,))
    else:
        # --- 🚨 THE FIX: EXISTING CLAIM UPDATE MATH ---
        old_status = existing_claim[0]
        new_status = entry.settlement_status
        
        # If the status just changed from PENDING to SETTLED, move the money!
        if old_status in ["PENDING_CONSULTANT", "PENDING_TIMER"] and new_status in ["SETTLED", "INSTANT_SETTLED"]:
            cursor.execute("UPDATE hospital_wallet SET pending_escrow = pending_escrow - ?, available_balance = available_balance + ? WHERE id = 'HW-001'", (entry.hmo_payout, entry.hmo_payout))
            print(f"✅ Escrow Released: ₦{entry.hmo_payout} moved to Available Balance.")

    # Save to Ledger (Updates the row)
    cursor.execute('''
        INSERT OR REPLACE INTO audit_ledger 
        (claim_id, patient_id, doctor_name, procedure_name, clinical_indication, ai_score, status, resolved_by, deducted_amount, paycode, total_cost, hmo_payout, settlement_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (entry.claim_id, entry.patient_id, entry.doctor_name, entry.procedure_name,
          entry.clinical_indication, entry.ai_score, entry.status, entry.resolved_by,
          entry.deducted_amount, entry.paycode, entry.total_cost, entry.hmo_payout, entry.settlement_status))

    # Debit Patient Wallet
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
            pass
            
    # Fallback / Demo Bypass
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
        ai_reasoning_msg = "[System Checker] Clinical justification is too brief to evaluate. Full history and exam summary required."
        ai_suggestions = []
    else:
        ai_score = 0.50
        ai_reasoning_msg = ""
        ai_suggestions = []
        llm_success = False

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
            
            raw_reasoning = audit_data.get("reasoning", "AI Audit completed successfully.")
            ai_reasoning_msg = f"[Gemini 2.0 Flash] {raw_reasoning}"
            
            llm_success = True
            print(f"✅ Tier 1 (Gemini) succeeded: score={ai_score}")
        except Exception as e1:
            print(f"⚠️ Tier 1 (Gemini Cloud) Failed: {e1}")

        if not llm_success:
            print("🛡️ ACTIVATING TIER 2: PubMedBERT Medical NLI Fallback")
            nli_result = run_medical_nli_audit(notes, claim.procedure_name, extracted_indication)
            ai_score = nli_result["audit_score"]
            ai_reasoning_msg = nli_result["reasoning"]
            ai_suggestions = nli_result.get("suggestions", [])

    # 🆕 FINANCIAL SPLIT CALCULATION
    total_cost = claim.amount
    co_pay = total_cost * 0.20
    hmo_payout = total_cost * 0.80

    # 🆕 ASSIGNING THE FINANCIAL STATE MACHINE STATUS
    if ai_score >= 0.90:
        sla_tier = "Instant Payout"
        financial_status = "INSTANT_SETTLED"
    elif ai_score >= 0.75:
        sla_tier = "24-Hour Settlement"
        financial_status = "PENDING_CONSULTANT"
    elif ai_score >= 0.50:
        sla_tier = "48-Hour Escrow"
        financial_status = "PENDING_TIMER"
    else:
        sla_tier = "72-Hour HMO Audit"
        financial_status = "HMO_AUDIT_REJECTED"

    wallet = claim.patient.wallet_balance

    # Build Base Response Data
    response_data = {
        "payout_tier": sla_tier,
        "audit_score": round(ai_score, 2),
        "reasoning": ai_reasoning_msg,
        "clinical_indication": extracted_indication,
        "suggestions": ai_suggestions,
        "total_cost": total_cost,
        "hmo_payout": hmo_payout,
        "settlement_status": financial_status
    }

    if wallet >= co_pay:
        response_data.update({
            "status": "AUTHORIZED",
            "deducted": co_pay,
            "remaining": 0,
            "new_wallet_balance": wallet - co_pay,
            "message": "Authorized."
        })
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

        response_data.update({
            "status": "PARTIAL_PAYMENT",
            "deducted": wallet,
            "remaining": outstanding_amount,
            "new_wallet_balance": 0,
            "paycode": paycode,
            "message": "Wallet exhausted. Paycode generated."
        })

    return response_data


# ============================================================
# DIAGNOSTIC ENDPOINT 
# ============================================================
@app.get("/api/v1/debug/nli-test")
async def nli_diagnostic_test():
    # [Unchanged Logic]
    return {"status": "Diagnostic endpoint active"}


# ============================================================
# QUEUE + TRANSACTION ROUTES 
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


# ============================================================
# 🌟 🆕 CFO / ADMIN DASHBOARD ENDPOINTS
# ============================================================

@app.get("/api/v1/admin/hospital-wallet")
async def get_hospital_wallet():
    """Fetches the Master Bank Account and recent claims for the CFO Dashboard"""
    conn = sqlite3.connect('mediclaim_enterprise.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM hospital_wallet WHERE id = 'HW-001'")
    wallet = dict(cursor.fetchone())
    
    # 🟢 NEW: Added total_cost and deducted_amount to the CFO SQL Query
    cursor.execute("SELECT claim_id, procedure_name, total_cost, deducted_amount, hmo_payout, settlement_status, timestamp FROM audit_ledger ORDER BY timestamp DESC LIMIT 15")
    recent_claims = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    return {"wallet": wallet, "recent_claims": recent_claims}

@app.post("/api/v1/admin/consultant-approve/{claim_id}")
async def authorize_escrow_funds(claim_id: str):
    """The Consultant/Admin clicks 'Approve', moving money from Escrow to Available Balance"""
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    
    # Check if the money is actually trapped in escrow
    cursor.execute("SELECT hmo_payout, settlement_status FROM audit_ledger WHERE claim_id = ?", (claim_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Claim not found in ledger")
        
    payout_amount, current_status = row[0], row[1]
    
    if current_status in ["PENDING_CONSULTANT", "PENDING_TIMER"]:
        # 1. Move the Money
        cursor.execute("UPDATE hospital_wallet SET pending_escrow = pending_escrow - ?, available_balance = available_balance + ? WHERE id = 'HW-001'", (payout_amount, payout_amount))
        
        # 2. Update the Ledger Status
        cursor.execute("UPDATE audit_ledger SET settlement_status = 'SETTLED' WHERE claim_id = ?", (claim_id,))
        
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"₦{payout_amount} released from Escrow to Available Balance!"}
    
    conn.close()
    return {"status": "ignored", "message": f"Claim status is currently {current_status}. No funds moved."}