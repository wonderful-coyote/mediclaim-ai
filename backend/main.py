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
import requests
from pydantic import BaseModel 
from models import MedicalClaim
from typing import Optional, Any
from dotenv import load_dotenv
from auth_utils import generate_interswitch_auth
from google import genai

# Load your .env file
load_dotenv()
CLIENT_ID = os.getenv("INTERSWITCH_CLIENT_ID")
SECRET_KEY = os.getenv("INTERSWITCH_SECRET_KEY")
MERCHANT_CODE = "MX6072" 

# Configure Gemini (Tier 1)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

HF_TOKEN = os.getenv("HF_TOKEN")


app = FastAPI(title="MediClaim EHR Terminal")

app.add_middleware(
    CORSMiddleware,
    # allow_origins=["http://localhost:3000", "http://127.0.0.1:8000"],
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 🏥 MEDICLAIM INSURANCE PATIENT DATABASE
# ==========================================
# 🌟 FIX: Removed all copay_policy lines. Using exact hard limits.
PATIENTS_DB = {
    "PT-1029": {
        "name": "Ogooluwa Isaac", 
        "plan_id": "VALU_CARE", 
        "plan_name": "MediClaim ValuCare",
        "tier": "Q4", 
        "wallet_balance": 50000,
        "surgery_limit": 250000
    },
    "PT-2045": {
        "name": "Amaka Okafor", 
        "plan_id": "EASY_CARE", 
        "plan_name": "MediClaim EasyCare",
        "tier": "Q2", 
        "wallet_balance": 15000,
        "surgery_limit": 100000
    },
    "PT-3088": {
        "name": "Bayo Adeyemi", 
        "plan_id": "FLEXI_CARE", 
        "plan_name": "MediClaim FlexiCare",
        "tier": "Q1", 
        "wallet_balance": 5000,
        "surgery_limit": 0
    },
    "PT-4012": {
        "name": "Chioma Eze", 
        "plan_id": "MALARIA_PLAN", 
        "plan_name": "MediClaim Malaria Plan",
        "tier": "ACTIVE", 
        "wallet_balance": 2000,
        "surgery_limit": 0
    }
}

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
            total_cost REAL,
            hmo_payout REAL,
            settlement_status TEXT,
            reasoning TEXT,
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
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS hmo_claims (
            claim_id TEXT PRIMARY KEY,
            patient_id TEXT,
            doctor_name TEXT,
            procedure_name TEXT,
            status TEXT,
            ai_score REAL,
            total_cost REAL,
            hmo_payout REAL,
            deducted_amount REAL,
            paycode TEXT,
            clinical_indication TEXT,
            notes TEXT,
            ai_reasoning TEXT,
            messages_json TEXT,
            suggestions_json TEXT,
            resolved_by TEXT,
            settlement_status TEXT,
            raw_payload TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS hospital_wallet (
            id TEXT PRIMARY KEY,
            available_balance REAL,
            pending_escrow REAL
        )
    ''')
    
    cursor.execute("INSERT OR IGNORE INTO hospital_wallet (id, available_balance, pending_escrow) VALUES ('HW-001', 1250000.0, 0.0)")

    # Forward-compatible table migrations for existing local databases
    cursor.execute("PRAGMA table_info(hmo_claims)")
    existing_hmo_cols = {row[1] for row in cursor.fetchall()}
    if 'resolved_by' not in existing_hmo_cols:
        cursor.execute("ALTER TABLE hmo_claims ADD COLUMN resolved_by TEXT")
    if 'settlement_status' not in existing_hmo_cols:
        cursor.execute("ALTER TABLE hmo_claims ADD COLUMN settlement_status TEXT")

    # Seed the database with our dynamically loaded MediClaim Insurance patients
    for pid, pdata in PATIENTS_DB.items():
        cursor.execute("INSERT OR IGNORE INTO patients (patient_id, wallet_balance) VALUES (?, ?)", (pid, pdata["wallet_balance"]))
        cursor.execute("SELECT COUNT(*) FROM wallet_transactions WHERE patient_id = ?", (pid,))
        if cursor.fetchone()[0] == 0:
            cursor.execute('''
                INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
                VALUES (?, ?, 'INITIAL_BAL', 'CREDIT', 'Opening Balance')
            ''', (pid, pdata["wallet_balance"]))
            
    conn.commit()
    conn.close()
    print("✅ Database Initialized with Transaction Ledger & MediClaim Insurance Patients.")

init_db()


# ============================================================
# 🌟 TIER 2: Hugging Face Cloud Inference API
# ============================================================
HF_API_URL = "https://router.huggingface.co/hf-inference/models/pritamdeka/PubMedBERT-MNLI-MedNLI"

def _normalize_hf_scores(result: object) -> dict:
    """
    Normalize Hugging Face router output into explicit E / N / C scores.

    PubMedBERT-MNLI-MedNLI uses this id2label mapping on its model card:
    0 = contradiction, 1 = entailment, 2 = neutral
    """
    if isinstance(result, list) and result and isinstance(result[0], list):
        scores = result[0]
    elif isinstance(result, list):
        scores = result
    else:
        scores = []

    if not isinstance(scores, list):
        return {"E": 0.00001, "N": 0.00001, "C": 0.00001}

    label_map = {
        "label_0": "C",
        "contradiction": "C",
        "label_1": "E",
        "entailment": "E",
        "label_2": "N",
        "neutral": "N",
    }

    normalized = {"E": 0.00001, "N": 0.00001, "C": 0.00001}

    for item in scores:
        if not isinstance(item, dict):
            continue
        raw_label = str(item.get("label", "")).strip().lower()
        bucket = label_map.get(raw_label)
        if bucket:
            normalized[bucket] = float(item.get("score", 0.00001))

    return normalized


def get_nli_scores(premise: str, hypothesis: str) -> dict:
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json"
    }

    if not HF_TOKEN:
        print("❌ HF_TOKEN is missing. Tier 2 cannot call Hugging Face.")
        return {"E": 0.00001, "N": 0.00001, "C": 0.00001}

    # IMPORTANT:
    # The HF Inference text-classification endpoint expects `inputs` to be a STRING,
    # not a nested object. Using {"text": ..., "text_pair": ...} triggers:
    # TextClassificationPipeline.__call__() missing 1 required positional argument: 'inputs'
    #
    # For this NLI model, we keep the sentence-pair encoding in a single string with [SEP],
    # which is the format that was already accepted by the endpoint in your earlier run.
    payload = {
        "inputs": f"{hypothesis} [SEP] {premise}",
        "parameters": {"top_k": 3},
        "options": {"wait_for_model": True}
    }

    for attempt in range(4):
        try:
            response = requests.post(HF_API_URL, headers=headers, json=payload, timeout=30)

            if response.status_code == 200:
                result = response.json()
                normalized = _normalize_hf_scores(result)
                print(f"   [HF RAW] {result}")
                return normalized

            if response.status_code in [429, 503]:
                print(f"⏳ Router is busy or model is loading (Attempt {attempt + 1}/4)... waiting 10s.")
                time.sleep(10)
                continue

            print(f"❌ HF Router Error: {response.status_code} - {response.text}")
            break

        except Exception as e:
            print(f"❌ Connection Error: {e}")
            break

    return {"E": 0.00001, "N": 0.00001, "C": 0.00001}


def get_db_wallet_balance(patient_id: str) -> float:
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute("SELECT wallet_balance FROM patients WHERE patient_id = ?", (patient_id,))
    row = cursor.fetchone()
    conn.close()
    return float(row[0]) if row else 0.0


def normalize_claim_status(status: Optional[str]) -> str:
    raw = (status or '').strip().upper()
    if raw in {'APPROVED', 'AUTHORIZED', 'PARTIAL_PAYMENT'}:
        return 'DISPATCHED'
    return raw or 'PENDING'


def is_terminal_claim_status(status: Optional[str]) -> bool:
    return normalize_claim_status(status) in {'DISPATCHED', 'REJECTED'}


def get_benefit_bucket(procedure_name: str) -> Optional[str]:
    name = (procedure_name or '').lower()
    surgery_keywords = [
        'ectomy', 'otomy', 'ostomy', 'appendectomy', 'surgery', 'surgical',
        'laparotomy', 'laparoscopy', 'repair', 'fixation', 'fusion',
        'arthro', 'bypass', 'graft', 'resection', 'amputation',
        'craniotomy', 'cystectomy', 'mastectomy', 'nephrectomy',
        'hysterectomy', 'caesarean', 'cesarean', 'tips'
    ]
    if any(keyword in name for keyword in surgery_keywords):
        return 'SURGERY'
    return None


def get_patient_benefit_usage(patient_id: str, benefit_bucket: str) -> float:
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT procedure_name, hmo_payout, status, settlement_status
        FROM audit_ledger
        WHERE patient_id = ?
        """,
        (patient_id,)
    )
    rows = cursor.fetchall()
    conn.close()

    total = 0.0
    for procedure_name, hmo_payout, status, settlement_status in rows:
        normalized_status = normalize_claim_status(status)
        normalized_settlement = (settlement_status or '').upper()
        if normalized_status in {'REJECTED', 'PENDING', 'NEEDS_INFO'}:
            continue
        if 'REJECTED' in normalized_settlement:
            continue
        if get_benefit_bucket(procedure_name or '') != benefit_bucket:
            continue
        total += float(hmo_payout or 0.0)
    return total


def derive_settlement_status(status: str, total_cost: float, hmo_payout: float, deducted_amount: float, current_status: Optional[str] = None) -> str:
    normalized_status = normalize_claim_status(status)
    out_of_pocket_total = max(0.0, float(total_cost or 0.0) - float(hmo_payout or 0.0))
    deducted_amount = float(deducted_amount or 0.0)
    current_upper = (current_status or '').upper()

    if normalized_status == 'REJECTED':
        if current_upper and 'REJECTED' in current_upper:
            return current_upper
        return 'HMO_AUDIT_REJECTED'

    if normalized_status == 'DISPATCHED':
        if float(hmo_payout or 0.0) <= 0:
            return 'PATIENT_RESPONSIBLE_PAID' if deducted_amount >= out_of_pocket_total else 'PATIENT_RESPONSIBLE_PENDING_PT'
        return 'FULLY_SETTLED' if deducted_amount >= out_of_pocket_total else 'HMO_APPROVED_PENDING_PT'

    if current_upper:
        return current_upper
    return 'PENDING_AI_AUDIT'


def sync_hmo_claim_snapshot(claim: dict[str, Any]) -> None:
    claim_id = claim.get('id') or claim.get('claim_id')
    if not claim_id:
        return

    patient_id = claim.get('patientId') or claim.get('patient_id') or 'PT-1029'
    doctor_name = claim.get('doctorName') or claim.get('doctor_name') or 'Unknown Doctor'
    procedure_name = claim.get('testName') or claim.get('procedure_name') or 'Unknown Procedure'
    incoming_status = claim.get('status')
    status = normalize_claim_status(incoming_status)
    ai_score = float(claim.get('aiScore') or claim.get('ai_score') or 0.0)
    total_cost = float(claim.get('total_cost') or claim.get('totalCost') or 0.0)
    hmo_payout = float(claim.get('hmo_payout') or claim.get('hmoPayout') or 0.0)
    deducted_amount = float(claim.get('deductedAmount') or claim.get('deducted_amount') or 0.0)
    paycode = claim.get('paycode')
    clinical_indication = claim.get('clinicalIndication') or claim.get('clinical_indication') or ''
    notes = claim.get('notes') or claim.get('clinical_notes') or ''
    ai_reasoning = claim.get('aiReasoning') or claim.get('ai_reasoning') or ''
    incoming_messages = claim.get('messages', [])
    incoming_suggestions = claim.get('suggestions', [])
    messages_json = json.dumps(incoming_messages)
    suggestions_json = json.dumps(incoming_suggestions)
    resolved_by = claim.get('resolvedBy') or claim.get('resolved_by') or ''
    settlement_status = claim.get('settlement_status') or ''
    raw_payload = json.dumps(claim)

    conn = sqlite3.connect('mediclaim_enterprise.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT status, patient_id, doctor_name, procedure_name, ai_score, total_cost, hmo_payout,
               deducted_amount, paycode, clinical_indication, notes, ai_reasoning, messages_json,
               suggestions_json, resolved_by, settlement_status
        FROM hmo_claims
        WHERE claim_id = ?
        """,
        (claim_id,)
    )
    existing = cursor.fetchone()

    if existing:
        existing_status = existing['status']
        if is_terminal_claim_status(existing_status) and not is_terminal_claim_status(status):
            status = existing_status
            settlement_status = settlement_status or (existing['settlement_status'] or '')
            resolved_by = resolved_by or (existing['resolved_by'] or '')

        patient_id = patient_id or (existing['patient_id'] or 'PT-1029')
        doctor_name = doctor_name or (existing['doctor_name'] or 'Unknown Doctor')
        procedure_name = procedure_name or (existing['procedure_name'] or 'Unknown Procedure')
        ai_score = ai_score if ai_score > 0 else float(existing['ai_score'] or 0.0)
        total_cost = total_cost if total_cost > 0 else float(existing['total_cost'] or 0.0)
        hmo_payout = hmo_payout if (hmo_payout > 0 or total_cost == 0) else float(existing['hmo_payout'] or 0.0)
        deducted_amount = deducted_amount if (deducted_amount > 0 or total_cost == 0) else float(existing['deducted_amount'] or 0.0)
        paycode = paycode or existing['paycode']
        clinical_indication = clinical_indication or (existing['clinical_indication'] or '')
        notes = notes or (existing['notes'] or '')
        ai_reasoning = ai_reasoning or (existing['ai_reasoning'] or '')
        if not incoming_messages:
            messages_json = existing['messages_json'] or '[]'
        if not incoming_suggestions:
            suggestions_json = existing['suggestions_json'] or '[]'
        resolved_by = resolved_by or (existing['resolved_by'] or '')
        settlement_status = settlement_status or (existing['settlement_status'] or '')

    cursor.execute(
        """
        INSERT INTO hmo_claims (
            claim_id, patient_id, doctor_name, procedure_name, status, ai_score,
            total_cost, hmo_payout, deducted_amount, paycode, clinical_indication,
            notes, ai_reasoning, messages_json, suggestions_json, resolved_by,
            settlement_status, raw_payload, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(claim_id) DO UPDATE SET
            patient_id=excluded.patient_id,
            doctor_name=excluded.doctor_name,
            procedure_name=excluded.procedure_name,
            status=excluded.status,
            ai_score=excluded.ai_score,
            total_cost=excluded.total_cost,
            hmo_payout=excluded.hmo_payout,
            deducted_amount=excluded.deducted_amount,
            paycode=excluded.paycode,
            clinical_indication=excluded.clinical_indication,
            notes=excluded.notes,
            ai_reasoning=excluded.ai_reasoning,
            messages_json=excluded.messages_json,
            suggestions_json=excluded.suggestions_json,
            resolved_by=excluded.resolved_by,
            settlement_status=excluded.settlement_status,
            raw_payload=excluded.raw_payload,
            updated_at=CURRENT_TIMESTAMP
        """,
        (
            claim_id, patient_id, doctor_name, procedure_name, status, ai_score,
            total_cost, hmo_payout, deducted_amount, paycode, clinical_indication,
            notes, ai_reasoning, messages_json, suggestions_json, resolved_by,
            settlement_status, raw_payload
        ),
    )
    conn.commit()
    conn.close()


def sync_audit_row_from_queue_claim(claim: dict[str, Any]) -> None:
    claim_id = claim.get('id') or claim.get('claim_id')
    if not claim_id or claim.get('isArchived'):
        return

    normalized_status = normalize_claim_status(claim.get('status'))
    if normalized_status == 'DISPATCHED':
        return

    patient_id = claim.get('patientId') or claim.get('patient_id') or 'PT-1029'
    doctor_name = claim.get('doctorName') or claim.get('doctor_name') or 'Unknown Doctor'
    procedure_name = claim.get('testName') or claim.get('procedure_name') or 'Unknown Procedure'
    ai_score = float(claim.get('aiScore') or claim.get('ai_score') or 0.0)
    total_cost = float(claim.get('total_cost') or claim.get('totalCost') or 0.0)
    hmo_payout = float(claim.get('hmo_payout') or claim.get('hmoPayout') or 0.0)
    deducted_amount = float(claim.get('deductedAmount') or claim.get('deducted_amount') or 0.0)
    paycode = claim.get('paycode')
    clinical_indication = claim.get('clinicalIndication') or claim.get('clinical_indication') or ''
    reasoning = claim.get('aiReasoning') or claim.get('ai_reasoning') or ''
    settlement_status = derive_settlement_status(normalized_status, total_cost, hmo_payout, deducted_amount, claim.get('settlement_status'))

    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM audit_ledger WHERE claim_id = ?", (claim_id,))
    existing = cursor.fetchone()
    if existing and normalize_claim_status(existing[0]) in {'DISPATCHED', 'REJECTED'}:
        conn.close()
        return

    cursor.execute(
        """
        INSERT INTO audit_ledger (
            claim_id, patient_id, doctor_name, procedure_name, clinical_indication,
            ai_score, status, resolved_by, deducted_amount, paycode, total_cost,
            hmo_payout, settlement_status, reasoning
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(claim_id) DO UPDATE SET
            patient_id=excluded.patient_id,
            doctor_name=excluded.doctor_name,
            procedure_name=excluded.procedure_name,
            clinical_indication=excluded.clinical_indication,
            ai_score=excluded.ai_score,
            status=excluded.status,
            resolved_by=excluded.resolved_by,
            deducted_amount=excluded.deducted_amount,
            paycode=excluded.paycode,
            total_cost=excluded.total_cost,
            hmo_payout=excluded.hmo_payout,
            settlement_status=excluded.settlement_status,
            reasoning=excluded.reasoning
        """,
        (
            claim_id, patient_id, doctor_name, procedure_name, clinical_indication,
            ai_score, normalized_status, 'HMO_QUEUE_SYNC', deducted_amount, paycode, total_cost,
            hmo_payout, settlement_status, reasoning
        ),
    )
    conn.commit()
    conn.close()


# ============================================================
# 🌟 CORE FUNCTION: run_medical_nli_audit (Tier 2 Dual-Matrix)
# ============================================================
def _contains_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(p, text, flags=re.I) for p in patterns)


def _extract_numeric_mm(text: str) -> Optional[float]:
    match = re.search(r'(?:appendix|appendiceal)[^\n.]{0,80}?(\d+(?:\.\d+)?)\s*mm', text, flags=re.I)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def _is_appendectomy(procedure_name: str) -> bool:
    p = procedure_name.lower()
    return any(term in p for term in ['appendectomy', 'appendicectomy'])


def _is_tips(procedure_name: str) -> bool:
    p = procedure_name.lower()
    return 'tips' in p or 'transjugular intrahepatic portosystemic shunt' in p


def _appendicitis_feature_catalog():
    return [
        {
            'label': 'Migratory pain from periumbilical area to RLQ',
            'patterns': [r'periumbilical[^.]{0,120}rlq', r'migrat\w+[^.]{0,120}rlq'],
            'dx_weight': 1.2,
            'proc_weight': 0.8,
        },
        {
            'label': 'Associated anorexia / nausea / vomiting',
            'patterns': [r'anorexia', r'nausea', r'vomit'],
            'dx_weight': 0.6,
            'proc_weight': 0.2,
        },
        {
            'label': 'Fever or systemic inflammatory response',
            'patterns': [r'temp\s*3[8-9](?:\.\d+)?', r'fever', r'hr\s*1\d{2,}'],
            'dx_weight': 0.5,
            'proc_weight': 0.3,
        },
        {
            'label': "Localized RLQ / McBurney's point tenderness",
            'patterns': [r'rlq pain', r'rlq tenderness', r'mcburney'],
            'dx_weight': 1.4,
            'proc_weight': 1.2,
        },
        {
            'label': 'Peritoneal irritation or guarding',
            'patterns': [r'guarding', r'rebound', r'rigid'],
            'dx_weight': 0.9,
            'proc_weight': 1.2,
        },
        {
            'label': 'Positive appendiceal provocation signs',
            'patterns': [r'rovsing', r'psoas', r'obturator'],
            'dx_weight': 0.8,
            'proc_weight': 0.8,
        },
        {
            'label': 'Leukocytosis or neutrophilia',
            'patterns': [r'wbc', r'neutroph', r'left shift', r'leukocyt'],
            'dx_weight': 1.0,
            'proc_weight': 0.7,
        },
        {
            'label': 'Elevated inflammatory marker such as CRP',
            'patterns': [r'crp[^.]{0,40}(elev|\d)', r'c-reactive'],
            'dx_weight': 0.4,
            'proc_weight': 0.2,
        },
        {
            'label': 'Ultrasound evidence of inflamed appendix',
            'patterns': [r'non-?compressible appendix', r'dilated[^.]{0,60}appendix', r'appendi[^.]{0,80}fluid'],
            'dx_weight': 2.0,
            'proc_weight': 1.8,
        },
        {
            'label': 'Appendix diameter above 6 mm',
            'patterns': [],
            'dx_weight': 1.0,
            'proc_weight': 0.9,
        },
        {
            'label': 'High Alvarado score',
            'patterns': [r'alvarado score\s*[:\-]?\s*([789]|10)'],
            'dx_weight': 0.8,
            'proc_weight': 0.8,
        },
        {
            'label': 'Important alternative diagnoses documented as excluded',
            'patterns': [r'other conflicting conditions effectively excluded', r'ruled out', r'excluded'],
            'dx_weight': 0.4,
            'proc_weight': 0.3,
        },
    ]


def _score_appendicitis_features(clean_notes: str) -> dict:
    diameter_mm = _extract_numeric_mm(clean_notes)
    features = _appendicitis_feature_catalog()
    matched = []
    missing = []
    dx_hit = 0.0
    proc_hit = 0.0
    dx_total = sum(f['dx_weight'] for f in features)
    proc_total = sum(f['proc_weight'] for f in features)

    for feature in features:
        found = _contains_any(clean_notes, feature['patterns']) if feature['patterns'] else False
        if feature['label'] == 'Appendix diameter above 6 mm':
            found = diameter_mm is not None and diameter_mm > 6

        if found:
            matched.append(feature['label'])
            dx_hit += feature['dx_weight']
            proc_hit += feature['proc_weight']
        else:
            missing.append(feature['label'])

    strong_objective_core = all([
        _contains_any(clean_notes, [r'migrat\w+[^.]{0,120}rlq', r'periumbilical[^.]{0,120}rlq']),
        _contains_any(clean_notes, [r'rlq pain', r'rlq tenderness', r'mcburney']),
        _contains_any(clean_notes, [r'wbc', r'neutroph', r'left shift', r'leukocyt']),
        _contains_any(clean_notes, [r'non-?compressible appendix', r'dilated[^.]{0,60}appendix']) or (diameter_mm is not None and diameter_mm > 6),
    ])

    dx_score = round(dx_hit / dx_total, 4) if dx_total else 0.0
    proc_score = round(proc_hit / proc_total, 4) if proc_total else 0.0
    dx_score = min(dx_score, 0.96)
    proc_score = min(proc_score, 0.94)

    if strong_objective_core:
        dx_score = max(dx_score, 0.93)
        proc_score = max(proc_score, 0.91)

    rationale_bits = []
    if strong_objective_core:
        rationale_bits.append('Classic appendicitis evidence cluster detected: migratory pain, focal RLQ tenderness, inflammatory labs, and objective ultrasound support.')
    if diameter_mm is not None:
        rationale_bits.append(f'Appendix diameter documented at {diameter_mm:.1f} mm.')

    return {
        'matched': matched,
        'missing': missing,
        'diameter_mm': diameter_mm,
        'dx_score': dx_score,
        'proc_score': proc_score,
        'strong_objective_core': strong_objective_core,
        'rationale_bits': rationale_bits,
    }


def _appendicitis_diagnosis_rule_audit(clean_notes: str, diagnosis: str) -> Optional[dict]:
    if 'appendicitis' not in diagnosis.lower():
        return None

    scored = _score_appendicitis_features(clean_notes)
    return {
        'applies': True,
        'matched': scored['matched'],
        'missing': scored['missing'],
        'score': scored['dx_score'],
        'rationale_bits': scored['rationale_bits'],
        'engine': 'appendicitis_diagnosis_overlay',
    }


def _note_domain_catalog() -> dict:
    return {
        'abdominal_gi': [
            ('RLQ or appendiceal pain pattern', [r'rlq', r'mcburney', r'appendix', r'appendicitis', r'periumbilical', r'rovsing', r'psoas'], 0.35),
            ('Abdominal exam abnormality', [r'guarding', r'rebound', r'rigid', r'abdomen shows'], 0.30),
            ('GI symptom cluster', [r'nausea', r'anorexia', r'vomit', r'bowel movements'], 0.20),
            ('Abdominal imaging support', [r'ultrasound', r'periappendiceal', r'non-?compressible'], 0.25),
        ],
        'hepatobiliary_portal': [
            ('Portal / hepatic disease language', [r'portal hypertension', r'cirrho', r'hepatic', r'liver disease', r'jaundice'], 0.35),
            ('Variceal bleeding language', [r'varice', r'hematemesis', r'melena', r'upper gi bleed'], 0.35),
            ('Ascites / hydrothorax language', [r'ascites', r'hydrothorax', r'paracentesis'], 0.30),
            ('Budd-Chiari or venous outflow language', [r'budd[- ]?chiari', r'hepatic venous outflow'], 0.30),
        ],
        'infectious_malaria': [
            ('Malaria-specific language', [r'malaria', r'parasitem', r'plasmodium', r'mp test'], 0.60),
            ('Rigors / cyclic fever pattern', [r'chills', r'rigors', r'intermittent fever', r'sweats'], 0.25),
            ('Endemic exposure / mosquito language', [r'mosquito', r'endemic', r'travel history'], 0.15),
        ],
        'urinary': [
            ('Urinary symptom cluster', [r'dysuria', r'hematuria', r'frequency', r'urgency', r'flank pain'], 0.45),
            ('Urine / UTI language', [r'urinalysis', r'uti', r'urine', r'pyuria'], 0.35),
            ('Renal imaging / stone language', [r'hydroneph', r'renal', r'ureter', r'cva tenderness'], 0.20),
        ],
        'gyn_ob': [
            ('Pregnancy or ectopic language', [r'pregnan', r'ectopic', r'lmp', r'amenorrh'], 0.45),
            ('Pelvic / vaginal language', [r'pelvic pain', r'vaginal', r'adnex', r'uter'], 0.35),
            ('OB/GYN imaging or exam language', [r'transvaginal', r'cervical motion tenderness', r'ovarian'], 0.20),
        ],
        'pulmonary': [
            ('Respiratory symptom cluster', [r'cough', r'dyspn', r'shortness of breath', r'wheeze'], 0.45),
            ('Chest imaging / lung language', [r'chest x-?ray', r'consolidation', r'pneumonia', r'pleural'], 0.35),
            ('Hypoxia language', [r'spo2', r'oxygen', r'hypoxi'], 0.20),
        ],
        'cardiac': [
            ('Cardiac symptom cluster', [r'chest pain', r'palpitation', r'syncope'], 0.35),
            ('Cardiac biomarker / ECG language', [r'troponin', r'ecg', r'stemi', r'nstemi'], 0.45),
            ('Heart failure language', [r'orthopnea', r'pedal edema', r'jvp', r'heart failure'], 0.20),
        ],
        'neuro': [
            ('Focal neurologic language', [r'weakness', r'focal deficit', r'aphasia', r'seizure'], 0.45),
            ('Neuroimaging language', [r'ct brain', r'mri brain', r'intracranial'], 0.35),
            ('Meningitic / CNS language', [r'neck stiffness', r'photophobia', r'altered mental'], 0.20),
        ],
        'general_inflammation': [
            ('Inflammatory labs', [r'wbc', r'crp', r'neutroph', r'left shift', r'leukocyt'], 0.45),
            ('Fever / tachycardia', [r'fever', r'temp\s*3[8-9](?:\.\d+)?', r'hr\s*1\d{2,}'], 0.35),
            ('Objective acute imaging finding', [r'fluid', r'non-?compressible', r'dilated'], 0.20),
        ],
    }


def _score_note_domains(clean_notes: str) -> dict:
    domain_scores = {}
    matched_features = {}
    for domain, feature_defs in _note_domain_catalog().items():
        score = 0.0
        matched = []
        for label, patterns, weight in feature_defs:
            if _contains_any(clean_notes, patterns):
                score += weight
                matched.append(label)
        domain_scores[domain] = round(min(score, 1.0), 4)
        matched_features[domain] = matched
    ordered = sorted(domain_scores.items(), key=lambda kv: kv[1], reverse=True)
    return {
        'scores': domain_scores,
        'matched': matched_features,
        'ordered': ordered,
    }


def _estimate_acute_severity(clean_notes: str) -> float:
    features = [
        (r'temp\s*3[8-9](?:\.\d+)?|fever', 0.20),
        (r'hr\s*1\d{2,}|tachy', 0.15),
        (r'guarding|rigid|rebound', 0.25),
        (r'wbc|neutroph|left shift|crp', 0.20),
        (r'ultrasound|ct|mri|x-?ray|non-?compressible|dilated', 0.20),
    ]
    hit = 0.0
    for pattern, weight in features:
        if re.search(pattern, clean_notes, flags=re.I):
            hit += weight
    return round(min(hit, 1.0), 4)


def _infer_domains_from_text(text: str) -> list[str]:
    t = text.lower()
    domains = []
    domain_tokens = {
        'abdominal_gi': ['append', 'abd', 'abdom', 'gall', 'biliary', 'bowel', 'colon', 'gi', 'gastric', 'pelvic'],
        'hepatobiliary_portal': ['liver', 'hepatic', 'portal', 'varice', 'ascites', 'tips'],
        'infectious_malaria': ['malaria', 'parasite', 'plasmodium'],
        'urinary': ['urine', 'urinal', 'renal', 'kidney', 'bladder', 'ureter', 'uti'],
        'gyn_ob': ['preg', 'uter', 'ovar', 'adnex', 'gyn', 'obstet', 'pelvic'],
        'pulmonary': ['lung', 'chest', 'pulm', 'resp', 'bronch', 'pleura'],
        'cardiac': ['card', 'ecg', 'echo', 'troponin', 'heart'],
        'neuro': ['brain', 'neuro', 'head', 'stroke', 'csf'],
        'general_inflammation': ['cbc', 'fbc', 'crp', 'esr', 'blood'],
    }
    for domain, tokens in domain_tokens.items():
        if any(tok in t for tok in tokens):
            domains.append(domain)
    return domains or ['general_inflammation']


def _infer_procedure_profile(procedure_name: str) -> dict:
    p = procedure_name.lower().strip()

    explicit_profiles = [
        {
            'id': 'appendectomy',
            'patterns': [r'appendectomy', r'appendicectomy'],
            'procedure_type': 'surgery',
            'domains': ['abdominal_gi'],
            'targeted': True,
            'anchors': [
                ('Appendiceal disease language', [r'appendicitis', r'appendix']),
                ('Localized RLQ signs', [r'mcburney', r'rovsing', r'rlq', r'psoas']),
            ],
        },
        {
            'id': 'tips',
            'patterns': [r'tips', r'transjugular intrahepatic portosystemic shunt'],
            'procedure_type': 'interventional',
            'domains': ['hepatobiliary_portal'],
            'targeted': True,
            'anchors': [
                ('Portal hypertension language', [r'portal hypertension', r'cirrho', r'hepatic']),
                ('Variceal bleeding / ascites language', [r'varice', r'hematemesis', r'melena', r'ascites']),
            ],
        },
        {
            'id': 'malaria_parasite_test',
            'patterns': [r'malaria parasite', r'mp', r'plasmodium', r'malaria.*test'],
            'procedure_type': 'lab',
            'domains': ['infectious_malaria'],
            'targeted': True,
            'anchors': [
                ('Malaria-specific language', [r'malaria', r'parasitem', r'plasmodium']),
                ('Rigors / cyclic fever language', [r'chills', r'rigors', r'intermittent fever', r'sweats']),
            ],
        },
        {
            'id': 'urinalysis',
            'patterns': [r'urinalysis', r'urine microscopy', r'urine dip'],
            'procedure_type': 'lab',
            'domains': ['urinary'],
            'targeted': False,
            'anchors': [('Urinary symptom language', [r'dysuria', r'hematuria', r'uti', r'flank pain'])],
        },
        {
            'id': 'pregnancy_test',
            'patterns': [r'pregnancy test', r'beta-hcg', r'hcg'],
            'procedure_type': 'lab',
            'domains': ['gyn_ob'],
            'targeted': False,
            'anchors': [('Pregnancy / gynecologic language', [r'pregnan', r'ectopic', r'amenorrh', r'vaginal'])],
        },
        {
            'id': 'cbc_fbc',
            'patterns': [r'cbc', r'fbc', r'full blood count'],
            'procedure_type': 'lab',
            'domains': ['general_inflammation'],
            'targeted': False,
            'anchors': [('Systemic inflammatory language', [r'fever', r'wbc', r'crp', r'infection'])],
        },
        {
            'id': 'crp',
            'patterns': [r'crp', r'c-reactive protein'],
            'procedure_type': 'lab',
            'domains': ['general_inflammation'],
            'targeted': False,
            'anchors': [('Inflammatory language', [r'fever', r'wbc', r'neutroph', r'inflamm'])],
        },
        {
            'id': 'ct_abdomen',
            'patterns': [r'ct abdomen', r'ct abd', r'ct abdomen/pelvis'],
            'procedure_type': 'imaging',
            'domains': ['abdominal_gi'],
            'targeted': False,
            'anchors': [('Abdominal localization language', [r'rlq', r'abdomen', r'guarding', r'mcburney'])],
        },
        {
            'id': 'abdominal_ultrasound',
            'patterns': [r'ultrasound', r'uss'],
            'procedure_type': 'imaging',
            'domains': ['abdominal_gi'],
            'targeted': False,
            'anchors': [('Abdominal localization language', [r'rlq', r'abdomen', r'guarding', r'mcburney'])],
        },
    ]

    for profile in explicit_profiles:
        if any(re.search(pattern, p, flags=re.I) for pattern in profile['patterns']):
            return profile

    if any(term in p for term in ['appendectomy', 'ectomy', 'resection', 'repair', 'laparotomy', 'laparoscopy']):
        procedure_type = 'surgery'
    elif any(term in p for term in ['tips', 'embolization', 'stent', 'angiography', 'angioplasty']):
        procedure_type = 'interventional'
    elif any(term in p for term in ['ultrasound', 'ct', 'mri', 'x-ray', 'xray', 'scan']):
        procedure_type = 'imaging'
    elif any(term in p for term in ['endoscopy', 'colonoscopy', 'gastroscopy', 'scope']):
        procedure_type = 'endoscopy'
    elif any(term in p for term in ['biopsy']):
        procedure_type = 'biopsy'
    elif any(term in p for term in ['test', 'panel', 'culture', 'serology', 'assay', 'urinalysis', 'fbc', 'cbc', 'crp']):
        procedure_type = 'lab'
    else:
        procedure_type = 'unknown'

    inferred_domains = _infer_domains_from_text(p)
    return {
        'id': 'generic_inferred_profile',
        'patterns': [],
        'procedure_type': procedure_type,
        'domains': inferred_domains,
        'targeted': procedure_type in ['surgery', 'interventional', 'biopsy'],
        'anchors': [
    (f'{domain} domain anchor', [re.escape(domain)])
    for domain in inferred_domains
],
    }


def _generic_procedure_rule_audit(clean_notes: str, procedure_name: str, diagnosis: str) -> dict:
    note_analysis = _score_note_domains(clean_notes)
    note_scores = note_analysis['scores']
    dominant_domains = [d for d, s in note_analysis['ordered'] if s >= 0.20]
    profile = _infer_procedure_profile(procedure_name)

    relevant_scores = {d: note_scores.get(d, 0.0) for d in profile['domains']}
    best_overlap = max(relevant_scores.values()) if relevant_scores else 0.0
    general_inflammation = note_scores.get('general_inflammation', 0.0)
    severity = _estimate_acute_severity(clean_notes)

    anchor_hits = []
    anchor_misses = []
    anchor_text = clean_notes + ' ' + diagnosis
    for label, patterns in profile.get('anchors', []):
        if _contains_any(anchor_text, patterns):
            anchor_hits.append(label)
        else:
            anchor_misses.append(label)

    dominant_primary = note_analysis['ordered'][0][0] if note_analysis['ordered'] else 'unknown'
    dominant_primary_score = note_analysis['ordered'][0][1] if note_analysis['ordered'] else 0.0
    strong_domain_mismatch = dominant_primary not in profile['domains'] and best_overlap < 0.15 and dominant_primary_score >= 0.45

    if profile['procedure_type'] == 'lab':
        if profile['targeted']:
            score = 0.05 + (0.45 * best_overlap) + (0.15 * general_inflammation) + (0.12 * len(anchor_hits))
            if strong_domain_mismatch:
                score = min(score, 0.18 + (0.05 * general_inflammation))
        else:
            score = 0.16 + (0.40 * max(best_overlap, general_inflammation)) + (0.08 * len(anchor_hits))
    elif profile['procedure_type'] == 'imaging':
        score = 0.08 + (0.55 * best_overlap) + (0.15 * severity) + (0.10 * len(anchor_hits))
        if strong_domain_mismatch:
            score = min(score, 0.20)
    elif profile['procedure_type'] in ['surgery', 'interventional', 'endoscopy', 'biopsy']:
        score = 0.03 + (0.60 * best_overlap) + (0.18 * severity) + (0.12 * len(anchor_hits))
        if strong_domain_mismatch:
            score = min(score, 0.10 if profile['procedure_type'] != 'endoscopy' else 0.15)
    else:
        score = 0.08 + (0.35 * best_overlap) + (0.12 * general_inflammation) + (0.08 * len(anchor_hits))
        if strong_domain_mismatch:
            score = min(score, 0.18)

    score = round(max(0.02, min(score, 0.88)), 4)

    matched = [f'{domain} overlap {value*100:.0f}%' for domain, value in relevant_scores.items() if value > 0]
    missing = [f'{domain} overlap 0%' for domain in profile['domains'] if relevant_scores.get(domain, 0.0) == 0]

    rationale_bits = [
        f"Generic compatibility engine classified '{procedure_name}' as {profile['procedure_type']} in domains {', '.join(profile['domains'])}.",
        f"Dominant note domains: {', '.join(f'{d} {note_scores[d]*100:.0f}%' for d in dominant_domains[:3]) if dominant_domains else 'none detected'}.",
    ]
    if strong_domain_mismatch:
        rationale_bits.append(
            f"Strong domain mismatch detected: the note is primarily {dominant_primary.replace('_', ' ')} while the requested procedure belongs to {', '.join(profile['domains'])}."
        )
    elif best_overlap > 0:
        rationale_bits.append(
            f"Best note-to-procedure domain overlap was {best_overlap*100:.0f}% in {max(relevant_scores, key=relevant_scores.get)}."
        )
    else:
        rationale_bits.append('No direct domain overlap was detected; residual score reflects generic uncertainty, not clinical support.')

    if anchor_hits:
        rationale_bits.append(f"Matched anchor concepts: {', '.join(anchor_hits)}.")
    else:
        rationale_bits.append('No procedure-specific anchor concepts were found in the note or diagnosis.')

    return {
        'applies': True,
        'score': score,
        'mode': 'replace',
        'matched': matched + anchor_hits,
        'missing': missing + anchor_misses,
        'rationale_bits': rationale_bits,
        'engine': f"generic_{profile['procedure_type']}_compatibility",
        'profile': profile,
        'note_domain_scores': note_scores,
    }


def _procedure_rule_audit(clean_notes: str, procedure_name: str, diagnosis: str) -> Optional[dict]:
    diagnosis_lower = diagnosis.lower()

    if _is_appendectomy(procedure_name):
        if 'appendicitis' not in diagnosis_lower and not _contains_any(clean_notes, [r'appendix', r'appendicitis']):
            return {
                'applies': True,
                'score': 0.08,
                'mode': 'cap',
                'matched': [],
                'missing': ['No appendicitis / appendix language tied to requested appendectomy'],
                'rationale_bits': [
                    'Procedure-diagnosis mismatch: appendectomy requires documented appendiceal disease or a clear operative appendiceal indication.'
                ],
                'engine': 'appendectomy_mismatch_guard',
            }

        scored = _score_appendicitis_features(clean_notes)
        return {
            'applies': True,
            'score': scored['proc_score'],
            'mode': 'floor',
            'matched': scored['matched'],
            'missing': scored['missing'],
            'rationale_bits': scored['rationale_bits'] + [
                'Procedure-specific overlay matched appendectomy to appendicitis-pattern evidence.'
            ],
            'engine': 'appendectomy_overlay',
        }

    if _is_tips(procedure_name):
        portal_features = [
            ('Portal hypertension or cirrhosis context', [r'portal hypertension', r'cirrho', r'hepatic fibrosis', r'end-stage liver']),
            ('Variceal bleeding / hematemesis / melena', [r'varice', r'hematemesis', r'melena', r'upper gi bleed']),
            ('Refractory ascites / hydrothorax', [r'ascites', r'hydrothorax', r'paracentesis']),
            ('Budd-?Chiari / hepatic venous outflow problem', [r'budd[- ]?chiari', r'hepatic venous outflow']),
        ]
        matched = [label for label, patterns in portal_features if _contains_any(clean_notes, patterns)]
        missing = [label for label, patterns in portal_features if not _contains_any(clean_notes, patterns)]
        appendicitis_cluster = _contains_any(clean_notes, [r'mcburney', r'rovsing', r'appendix', r'appendicitis', r'rlq'])

        if len(matched) == len(portal_features):
            score = 0.92
        elif matched:
            score = 0.55
        else:
            score = 0.02 if appendicitis_cluster else 0.08

        rationale_bits = []
        if appendicitis_cluster and not matched:
            rationale_bits.append('Procedure-diagnosis mismatch: the note describes an acute RLQ appendicitis pattern, not portal-hypertension complications that would justify TIPS.')
        elif not matched:
            rationale_bits.append('No documented portal-hypertension indication for TIPS was found in the note.')
        else:
            rationale_bits.append('Some portal-hypertension features were documented, but payer-grade TIPS justification would still need a tighter liver-specific indication statement.')

        return {
            'applies': True,
            'score': score,
            'mode': 'cap' if score < 0.9 else 'floor',
            'matched': matched,
            'missing': missing,
            'rationale_bits': rationale_bits,
            'engine': 'tips_overlay',
        }

    return _generic_procedure_rule_audit(clean_notes, procedure_name, diagnosis)


def _generate_debugger(proc_results: list[dict], dx_results: list[dict], proc_rule_audit: Optional[dict], dx_rule_audit: Optional[dict]) -> list[str]:
    lines = []

    def describe_block(title: str, results: list[dict]) -> None:
        if not results:
            lines.append(f'- {title}: no model outputs returned.')
            return
        best = max(results, key=lambda x: x['score'])
        worst = min(results, key=lambda x: x['score'])
        lines.append(
            f'- {title}: best hypothesis scored {best["score"]*100:.1f}% -> "{best["hypothesis"]}"; worst scored {worst["score"]*100:.1f}% -> "{worst["hypothesis"]}".'
        )
        contradicted = [r for r in results if r['raw']['C'] > r['raw']['E']]
        if contradicted:
            lines.append(
                f"- {title}: {len(contradicted)}/{len(results)} hypothesis variants were treated as contradiction by raw PubMedBERT, which usually means the wording is out-of-distribution for MedNLI rather than the case being clinically false."
            )

    describe_block('Procedure gate', proc_results)
    describe_block('Diagnosis gate', dx_results)

    if proc_rule_audit:
        matched = ', '.join(proc_rule_audit['matched'][:8]) if proc_rule_audit['matched'] else 'none'
        missing = ', '.join(proc_rule_audit['missing'][:6]) if proc_rule_audit['missing'] else 'none'
        mode = proc_rule_audit.get('mode', 'n/a')
        lines.append(
            f"- Procedure overlay ({proc_rule_audit['engine']}): score {proc_rule_audit['score']*100:.1f}% with mode {mode}. Matched: {matched}. Missing / weaker items: {missing}."
        )
        note_domain_scores = proc_rule_audit.get('note_domain_scores')
        if note_domain_scores:
            dominant = sorted(note_domain_scores.items(), key=lambda kv: kv[1], reverse=True)[:3]
            dominant_text = ', '.join(f"{name} {score*100:.0f}%" for name, score in dominant if score > 0)
            if dominant_text:
                lines.append(f'- Procedure overlay dominant note domains: {dominant_text}.')
        for bit in proc_rule_audit.get('rationale_bits', []):
            lines.append(f'- {bit}')

    if dx_rule_audit:
        matched = ', '.join(dx_rule_audit['matched'][:10]) if dx_rule_audit['matched'] else 'none'
        missing = ', '.join(dx_rule_audit['missing'][:6]) if dx_rule_audit['missing'] else 'none'
        lines.append(
            f"- Diagnosis overlay ({dx_rule_audit['engine']}): score {dx_rule_audit['score']*100:.1f}%. Matched: {matched}. Missing / weaker items: {missing}."
        )
        for bit in dx_rule_audit.get('rationale_bits', []):
            lines.append(f'- {bit}')

    return lines


def run_medical_nli_audit(notes: str, procedure_name: str, diagnosis: str, is_investigative: bool = False) -> dict:
    print("\n" + "="*60)
    print("🔍 [START] TIER 2: PubMedBERT DUAL-MATRIX AUDIT")
    print("="*60)

    try:
        print(f"📝 ORIGINAL NOTES:\n{notes}\n")

        blind_notes = re.sub(r'(?i)(?:working diagnos[ei]s|final diagnos[ei]s|diagnos[ei]s|\bdx\b|\bimp\b|impression)\s*[:\-]?\s*([^\n.]+)', '', notes)
        blind_notes = re.sub(r'(?i)(?:differentials?|\bddx\b)[^.]*?(?:ruled out|excluded|unlikely)', 'Other conflicting conditions effectively excluded', blind_notes)

        clean_notes = blind_notes.replace('\n', ' ').replace('>', '')
        clean_notes = re.sub(r'(?i)(PC:|HPC:|Exam:|P/?C:|Labs:|Imaging:|Assessment:)', ' ', clean_notes)
        clean_notes = re.sub(r'\s+', ' ', clean_notes).strip()

        print(f"🧼 CLEANED NARRATIVE (Fed to AI):\n{clean_notes}\n")

        if len(clean_notes) < 15:
            print("⚠️ WARNING: Notes too short. Fraud flag.")
            return {
                "audit_score": 0.15,
                "reasoning": "FRAUD/ERROR: No history.",
                "tier": "TIER_2_MEDNLI",
                "suggestions": ["Clinical note is too short to support diagnosis or medical necessity."]
            }

        print("⚙️ STEP 1: EVALUATING PROCEDURE")
        if 'appendectomy' in procedure_name.lower():
            proc_hypotheses = [
                f"This patient has acute appendicitis for which {procedure_name} is an appropriate definitive treatment.",
                f"The documented findings support surgical management with {procedure_name}.",
                f"The note describes a case in which {procedure_name} is medically justified.",
            ]
        else:
            proc_hypotheses = [
                f"The documented findings justify {procedure_name}.",
                f"The clinical note supports the medical necessity of {procedure_name}.",
                f"This patient has findings for which {procedure_name} is appropriate.",
            ]

        proc_results = []
        for hyp in proc_hypotheses:
            scores = get_nli_scores(clean_notes, hyp)
            score = scores['E'] / (scores['E'] + scores['C'] + 0.01)
            proc_results.append({'hypothesis': hyp, 'raw': scores, 'score': score})
            print(f"   [DEBUG] HYP: {hyp}")
            print(f"   [DEBUG] E: {scores['E']:.6f} | C: {scores['C']:.6f} => {score*100:.2f}%")
        raw_proc_score = max(r['score'] for r in proc_results)
        print(f"   [PROCEDURE BEST] {raw_proc_score*100:.2f}%\n")

        print("⚙️ STEP 2: EVALUATING DIAGNOSIS")
        if is_investigative:
            dx_hypotheses = [
                f"The presentation warrants investigation for {diagnosis}.",
                f"The documented findings make {diagnosis} a reasonable working diagnosis to investigate.",
            ]
        elif 'appendicitis' in diagnosis.lower():
            dx_hypotheses = [
                f"This patient has {diagnosis}.",
                f"The documented findings are classic for {diagnosis}.",
                f"The ultrasound and laboratory findings support {diagnosis}.",
            ]
        else:
            dx_hypotheses = [
                f"This patient has {diagnosis}.",
                f"The documented findings are consistent with {diagnosis}.",
                f"The note clinically supports the diagnosis of {diagnosis}.",
            ]

        dx_results = []
        for hyp in dx_hypotheses:
            scores = get_nli_scores(clean_notes, hyp)
            score = scores['E'] / (scores['E'] + scores['C'] + 0.01)
            dx_results.append({'hypothesis': hyp, 'raw': scores, 'score': score})
            print(f"   [DEBUG] HYP: {hyp}")
            print(f"   [DEBUG] E: {scores['E']:.6f} | C: {scores['C']:.6f} => {score*100:.2f}%")
        raw_dx_score = max(r['score'] for r in dx_results)
        print(f"   [DIAGNOSIS BEST] {raw_dx_score*100:.2f}%\n")

        print("🧠 STEP 3: PROCEDURE / DIAGNOSIS OVERLAY")
        proc_rule_audit = _procedure_rule_audit(clean_notes, procedure_name, diagnosis)
        dx_rule_audit = _appendicitis_diagnosis_rule_audit(clean_notes, diagnosis)

        if proc_rule_audit:
            print(f"   Procedure overlay engine: {proc_rule_audit['engine']}")
            print(f"   Procedure overlay mode: {proc_rule_audit['mode']}")
            print(f"   Procedure overlay score: {proc_rule_audit['score']*100:.2f}%")
            if proc_rule_audit['matched']:
                print(f"   Procedure matched features: {', '.join(proc_rule_audit['matched'])}")
        else:
            print("   No procedure-specific overlay applied.")

        if dx_rule_audit:
            print(f"   Diagnosis overlay engine: {dx_rule_audit['engine']}")
            print(f"   Diagnosis overlay score: {dx_rule_audit['score']*100:.2f}%")
            if dx_rule_audit['matched']:
                print(f"   Diagnosis matched features: {', '.join(dx_rule_audit['matched'])}")
            print()
        else:
            print("   No diagnosis-specific overlay applied.\n")

        if proc_rule_audit:
            if proc_rule_audit['mode'] == 'floor':
                proc_score = max(raw_proc_score, proc_rule_audit['score'])
            elif proc_rule_audit['mode'] == 'cap':
                proc_score = min(raw_proc_score, proc_rule_audit['score'])
            else:
                proc_score = proc_rule_audit['score']
        else:
            proc_score = raw_proc_score

        if dx_rule_audit:
            dx_score = max(raw_dx_score, dx_rule_audit['score'])
        else:
            dx_score = raw_dx_score

        final_score = min(proc_score, dx_score)

        print("⚖️ STEP 4: VALIDATION MATRIX")
        print(f"   min({proc_score*100:.1f}%, {dx_score*100:.1f}%) => {final_score*100:.2f}%\n")
        print("💡 AI DEBUGGER & IMPROVEMENT SUGGESTIONS:")

        debugger_lines = _generate_debugger(proc_results, dx_results, proc_rule_audit, dx_rule_audit)
        suggestions_list = []

        if final_score >= 0.90:
            reasoning = (
                f"[Tier 2 Calibrated Audit] Strong clinical correlation ({round(final_score * 100)}%). "
                f"The note supports the diagnosis of '{diagnosis}' and provides sufficient documented medical necessity for {procedure_name}."
            )
            suggestions_list.append("No major strengthening needed. Note already contains the key history, exam, laboratory, and imaging anchors.")
        elif final_score >= 0.75:
            reasoning = (
                f"[Tier 2 Calibrated Audit] Good but not yet premium documentation ({round(final_score * 100)}%). "
                f"The claim is clinically plausible, but the record can be made more explicit for payer-grade authorization."
            )
            suggestions_list.extend([
                "State the final diagnosis in one clean sentence separate from the narrative.",
                f"Explicitly document why {procedure_name} is being chosen now instead of observation or non-operative management.",
                "If imaging is positive, state the exact modality, diameter, and inflammatory features in one line."
            ])
        else:
            reasoning = (
                f"[Tier 2 Calibrated Audit] Documentation below approval target ({round(final_score * 100)}%). "
                f"Raw NLI wording mismatch, procedure-diagnosis incompatibility, and/or missing explicit evidence prevented a premium score."
            )
            suggestions_list.extend([
                "Tighten the diagnosis sentence so the disease label exactly matches the documented findings.",
                f"Add one explicit medical-necessity sentence linking the documented severity to {procedure_name}.",
                "Keep symptom chronology, focal examination findings, inflammatory markers, and imaging result in separate short statements.",
                "When the requested procedure belongs to a different organ-system or disease-family than the note, expect only a low compatibility score rather than an absolute zero."
            ])

        for line in debugger_lines:
            print(line)
        for suggestion in suggestions_list:
            print(f"- Suggestion: {suggestion}")

        print("="*60 + "\n")

        return {
            "audit_score": round(final_score, 2),
            "reasoning": reasoning,
            "suggestions": debugger_lines + suggestions_list,
            "tier": "TIER_2_MEDNLI_CALIBRATED"
        }

    except Exception as e:
        print(f"❌ Medical NLI Audit Failed: {str(e)}")
        return {
            "audit_score": 0.50,
            "reasoning": "[PubMedBERT] Audit engine error. Defaulting to manual review.",
            "tier": "FAILED",
            "suggestions": [str(e)]
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
    total_cost: float = 50000.0
    hmo_payout: float = 40000.0
    settlement_status: str = "PENDING_AI_AUDIT"
    reasoning: str = ""
    notes: str = ""
    suggestions: Optional[list[str]] = None
    messages: Optional[list[dict[str, Any]]] = None

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

    entry.status = normalize_claim_status(entry.status)
    entry.settlement_status = derive_settlement_status(
        entry.status,
        entry.total_cost,
        entry.hmo_payout,
        entry.deducted_amount,
        entry.settlement_status,
    )

    cursor.execute(
        "SELECT status, settlement_status FROM audit_ledger WHERE claim_id = ?",
        (entry.claim_id,)
    )
    existing_claim = cursor.fetchone()

    is_newly_dispatched = False
    if entry.status == "DISPATCHED":
        if not existing_claim:
            is_newly_dispatched = True
        elif normalize_claim_status(existing_claim[0]) != "DISPATCHED":
            is_newly_dispatched = True

    if is_newly_dispatched and entry.deducted_amount > 0:
        cursor.execute(
            "UPDATE hospital_wallet SET available_balance = available_balance + ? WHERE id = 'HW-001'",
            (entry.deducted_amount,)
        )

    if is_newly_dispatched and entry.hmo_payout > 0:
        if entry.settlement_status == "FULLY_SETTLED":
            cursor.execute(
                "UPDATE hospital_wallet SET available_balance = available_balance + ? WHERE id = 'HW-001'",
                (entry.hmo_payout,)
            )
        else:
            cursor.execute(
                "UPDATE hospital_wallet SET pending_escrow = pending_escrow + ? WHERE id = 'HW-001'",
                (entry.hmo_payout,)
            )

    cursor.execute(
        '''
        INSERT OR REPLACE INTO audit_ledger
        (claim_id, patient_id, doctor_name, procedure_name, clinical_indication, ai_score, status, resolved_by, deducted_amount, paycode, total_cost, hmo_payout, settlement_status, reasoning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            entry.claim_id, entry.patient_id, entry.doctor_name, entry.procedure_name,
            entry.clinical_indication, entry.ai_score, entry.status, entry.resolved_by,
            entry.deducted_amount, entry.paycode, entry.total_cost, entry.hmo_payout,
            entry.settlement_status, entry.reasoning
        )
    )

    if is_newly_dispatched and entry.deducted_amount > 0:
        cursor.execute("SELECT COUNT(*) FROM wallet_transactions WHERE txn_ref = ?", (entry.claim_id,))
        if cursor.fetchone()[0] == 0:
            try:
                cursor.execute(
                    "UPDATE patients SET wallet_balance = wallet_balance - ? WHERE patient_id = ?",
                    (entry.deducted_amount, entry.patient_id)
                )
                cursor.execute(
                    '''
                    INSERT INTO wallet_transactions (patient_id, amount, txn_ref, type, description)
                    VALUES (?, ?, ?, 'DEBIT', ?)
                    ''',
                    (entry.patient_id, entry.deducted_amount, entry.claim_id, f"Out-of-Pocket: {entry.procedure_name}")
                )
            except Exception as e:
                print(f"❌ Ledger Debit Failed: {e}")
                conn.rollback()

    # keep HMO claim history in sync as well
    raw_payload = {
        "id": entry.claim_id,
        "patientId": entry.patient_id,
        "doctorName": entry.doctor_name,
        "testName": entry.procedure_name,
        "status": entry.status,
        "aiScore": entry.ai_score,
        "deductedAmount": entry.deducted_amount,
        "clinicalIndication": entry.clinical_indication,
        "total_cost": entry.total_cost,
        "hmo_payout": entry.hmo_payout,
        "paycode": entry.paycode,
        "aiReasoning": entry.reasoning,
        "settlement_status": entry.settlement_status,
        "resolvedBy": entry.resolved_by,
        "notes": entry.notes or "",
        "suggestions": entry.suggestions or [],
        "messages": entry.messages or [],
    }

    conn.commit()
    conn.close()

    sync_hmo_claim_snapshot(raw_payload)
    return {"status": "success", "normalized_status": entry.status, "settlement_status": entry.settlement_status}


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


# 🌟 THE NEW DYNAMIC FILTERING DICTIONARY
@app.get("/api/v1/clinical/dictionary/{patient_id}")
async def get_patient_specific_dictionary(patient_id: str):
    patient = PATIENTS_DB.get(patient_id)
    if not patient:
        return []

    plan_id = patient["plan_id"]
    
    file_path = os.path.join(os.path.dirname(__file__), "clinical_dictionary.json")
    try:
        with open(file_path, "r") as f:
            all_procedures = json.load(f)
    except FileNotFoundError:
        return []

    covered_procedures = []
    
    for proc in all_procedures:
        # MALARIA PLAN: Hide everything except the Malaria test
        if plan_id == "MALARIA_PLAN":
            if "Malaria" in proc["name"]:
                covered_procedures.append(proc)
        
        # FLEXICARE (Q1): Show labs and basic radiology. Hide major surgeries
        elif plan_id == "FLEXI_CARE":
            if proc["dept"] in ["Laboratory", "Radiology"] and proc["id"] != "RAD-205": 
                covered_procedures.append(proc)
        
        # EASYCARE & VALUCARE: Show almost everything. 
        elif plan_id in ["EASY_CARE", "VALU_CARE"]:
            if plan_id == "EASY_CARE" and proc["id"] == "RAD-205":
                continue
            covered_procedures.append(proc)
            
    return covered_procedures


# 🌟 THE FULL LEVEL 4 AUTO-ADJUDICATION ENGINE (Updated for Hard Limits)
@app.post("/api/v1/ehr/order-procedure")
async def order_procedure(claim: MedicalClaim):
    patient_id = claim.patient.id
    procedure_name = claim.procedure_name
    notes = claim.clinical_notes.strip() if claim.clinical_notes else ""
    total_cost = claim.amount
    
    patient = PATIENTS_DB.get(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found in HMO Database")

    # 🌟 NEW LOGIC: Hierarchical NLP Extraction
    dx_match = re.search(r'(?i)(?:working diagnos[ei]s|final diagnos[ei]s|diagnos[ei]s|\bdx\b|\bimp\b|impression)\s*[:\-]?\s*([^\n.]+)', notes)
    ddx_match = re.search(r'(?i)(?:differentials?|\bddx\b)\s*[:\-]?\s*([^\n.]+)', notes)

    is_investigative = False
    
    # Rule 1: Definitive Diagnosis takes absolute precedence
    if dx_match:
        extracted_indication = dx_match.group(1).strip()
        
    # Rule 2: If only Differentials exist, check if they were explicitly ruled out
    elif ddx_match:
        ddx_text = ddx_match.group(1).strip()
        if "ruled out" in ddx_text.lower():
            extracted_indication = f"Evaluation for {procedure_name}" # Reset to baseline if differentials are gone
        else:
            extracted_indication = ddx_text
            is_investigative = True # Tell PubMedBERT we are investigating, not confirming
            
    # Rule 3: Catch-all fallback
    else:
        extracted_indication = f"Evaluation for {procedure_name}"

    note_has_complaint = bool(re.search(r'(?i)(presenting\s*complaint|complaint|\bc/?o\b|\bhpi\b|history|symptom|\bp/?c\b|\bhpc\b)', notes))
    note_has_diagnosis = bool(re.search(r'(?i)(diagnos[ei]s|\bdx\b|differential|\bddx\b|assessment|assess|\bimp\b|impression)', notes))

    # ==========================================
    # MATRIX 1: FINANCIAL & POLICY RULES ENGINE
    # ==========================================
    policy_passed = True
    coverage_exhausted = False
    policy_reasoning = ""
    hmo_payout = total_cost
    patient_owes = 0
    benefit_limit = 0.0
    benefit_used = 0.0
    benefit_remaining = 0.0
    benefit_bucket = get_benefit_bucket(procedure_name)

    if patient["plan_id"] == "MALARIA_PLAN" and "Malaria" not in procedure_name:
        policy_passed = False
        policy_reasoning = "[REJECTED: NON_MALARIA_CONDITION_EXCLUDED] This enrollee is on the Malaria Plan. Only malaria testing and ACTs are covered."
        hmo_payout = 0

    elif benefit_bucket == "SURGERY":
        benefit_limit = float(patient.get("surgery_limit", 0) or 0.0)
        benefit_used = get_patient_benefit_usage(patient_id, benefit_bucket)
        benefit_remaining = max(0.0, benefit_limit - benefit_used)

        if benefit_limit <= 0:
            policy_passed = False
            policy_reasoning = f"[REJECTED: SURGERY_NOT_COVERED] The {patient['plan_name']} does not cover major surgeries."
            hmo_payout = 0
        elif benefit_remaining <= 0:
            coverage_exhausted = True
            hmo_payout = 0
            patient_owes = total_cost
            policy_reasoning = (
                f"[BENEFIT_LIMIT_EXHAUSTED] Surgical benefit exhausted. "
                f"Approved surgical HMO payouts already used ₦{benefit_used:,.2f} "
                f"out of ₦{benefit_limit:,.2f}. This claim is patient-responsible."
            )
        elif total_cost > benefit_remaining:
            hmo_payout = benefit_remaining
            patient_owes = total_cost - benefit_remaining
            policy_reasoning = (
                f"[PARTIAL_BENEFIT_REMAINING] Only ₦{benefit_remaining:,.2f} "
                f"of the surgical benefit remains from the ₦{benefit_limit:,.2f} limit. "
                f"HMO covers the remaining benefit; patient covers the balance."
            )

    # ==========================================
    # MATRIX 2: CLINICAL AI ENGINE
    # ==========================================
    bad_note_quality = False
    if len(notes) < 20:
        bad_note_quality = True
        ai_score = 0.20
        ai_reasoning_msg = "[System Checker] Clinical justification is too brief to evaluate safely. Full presenting complaint, examination, and diagnosis summary required."
        ai_suggestions = [
            "Clinical notes are too brief for safe adjudication.",
            "Add a clear presenting complaint, focused examination findings, and a working/final diagnosis.",
        ]
    elif not (note_has_complaint and note_has_diagnosis):
        bad_note_quality = True
        ai_score = 0.30
        ai_reasoning_msg = "[System Checker] Clinical note structure is incomplete. The note must contain both a presenting complaint/history and an explicit diagnosis or assessment."
        ai_suggestions = [
            "Include a clear presenting complaint or history of presenting complaint.",
            "Include an explicit diagnosis, differential, or clinical impression.",
        ]
    else:
        ai_score = 0.50
        ai_reasoning_msg = ""
        ai_suggestions = []
        llm_success = False

        try:
            if gemini_client is None:
                raise RuntimeError("GEMINI_API_KEY is missing")

            prompt = f"""
            You are a strict Medical Auditor for MediClaim Insurance. 
            A Junior Doctor has ordered the following procedure/investigation: "{procedure_name}".
            They provided these clinical notes: "{notes}".
            
            Evaluate this claim based strictly on the standard clinical clerkship framework:
            1. Presenting Complaint (PC) & History of Presenting Complaint (HPC)
            2. Physical Examination Findings (General & Systemic)
            3. Final Diagnosis (Dx)

            YOUR TASK: Validate the "Logical Chain of Custody". 
            - Do the symptoms (PC/HPC) and examination findings logically lead to the stated Diagnosis?
            - If the history and exam contradict the diagnosis, heavily penalize the score (Fraud/Error catch).
            - Does the resulting clinical picture strictly justify the medical necessity of "{procedure_name}"?
            
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
            raw_text = (getattr(response, "text", "") or "").replace("```json", "").replace("```", "").strip()

            if not raw_text:
                raise ValueError("Gemini returned an empty response body")

            try:
                audit_data = json.loads(raw_text)
            except json.JSONDecodeError:
                match = re.search(r'\{.*\}', raw_text, re.DOTALL)
                if not match:
                    raise
                audit_data = json.loads(match.group(0))

            ai_score = float(audit_data.get("audit_score", 0.50))
            raw_reasoning = audit_data.get("reasoning", "AI Audit completed successfully.")
            ai_reasoning_msg = f"[Gemini 2.0 Flash] {raw_reasoning}"

            llm_success = True
            print(f"✅ Tier 1 (Gemini) succeeded: score={ai_score}")
        except Exception as e1:
            print(f"⚠️ Tier 1 (Gemini Cloud) Failed: {e1}")

        if not llm_success:
            print("🛡️ ACTIVATING TIER 2: PubMedBERT Medical NLI Fallback")
            nli_result = run_medical_nli_audit(notes, procedure_name, extracted_indication, is_investigative)
            ai_score = nli_result["audit_score"]
            ai_reasoning_msg = nli_result["reasoning"]
            ai_suggestions = nli_result.get("suggestions", [])

    # ==========================================
    # THE LEVEL 4 ADJUDICATION DECISION
    # ==========================================

    policy_self_pay_required = (not policy_passed) or coverage_exhausted

    if bad_note_quality:
        status = "REJECTED"
        settlement_status = "AUTO_CLINICAL_REJECTED"
        final_reasoning = f"❌ AUTOMATIC CLINICAL REJECTION. \nReason: Inadequate clinical note quality. \nClinical: {ai_reasoning_msg}"
        sla_tier = "Clinical Rejected"

    elif ai_score < 0.50:
        status = "REJECTED"
        settlement_status = "AUTO_CLINICAL_REJECTED"
        final_reasoning = f"❌ AUTOMATIC CLINICAL REJECTION. \nClinical Score: {round(ai_score * 100)}%. Scores below 50% are rejected without HMO manual review. \nClinical: {ai_reasoning_msg}"
        sla_tier = "Clinical Rejected"

    elif policy_self_pay_required:
        hmo_payout = 0
        patient_owes = total_cost
        status = "AUTHORIZED"
        settlement_status = "PATIENT_RESPONSIBLE_PENDING_PT"
        sla_tier = "Self-Pay Checkout"
        if ai_score >= 0.90:
            final_reasoning = (
                f"💳 SELF-PAY CHECKOUT AUTHORIZED. \nPolicy: {policy_reasoning} \nClinical: {ai_reasoning_msg} \nOutcome: This claim is clinically justified but not payable by the HMO. Patient may proceed out-of-pocket."
            )
        else:
            final_reasoning = (
                f"💳 SELF-PAY CHECKOUT AVAILABLE. \nPolicy: {policy_reasoning} \nClinical: {ai_reasoning_msg} \nOutcome: HMO coverage is unavailable. The claim is not routed for HMO payout, but the patient may still proceed as self-pay."
            )

    elif ai_score >= 0.90:
        status = "AUTHORIZED"
        settlement_status = "INSTANT_SETTLED"
        sla_tier = "Instant Payout"

        if patient_owes > 0:
            if policy_reasoning:
                final_reasoning = f"✅ PARTIAL STP ACHIEVED. \nPolicy: {policy_reasoning} \nClinical: {ai_reasoning_msg}"
            else:
                final_reasoning = f"✅ PARTIAL STP ACHIEVED. \nPolicy: Patient co-pay applies. \nClinical: {ai_reasoning_msg}"
        else:
            final_reasoning = f"✅ STRAIGHT-THROUGH PROCESSING. \nPolicy: {patient['plan_name']} Active. 100% Covered. \nClinical: {ai_reasoning_msg}"

    else:
        status = "PENDING"
        settlement_status = "PENDING_HMO_REVIEW"
        if policy_reasoning:
            final_reasoning = f"⚠️ MANUAL REVIEW ROUTING. \nPolicy: {policy_reasoning} \nClinical: {ai_reasoning_msg}"
        else:
            final_reasoning = f"⚠️ MANUAL REVIEW ROUTING. \nPolicy: Valid Limit. \nClinical: {ai_reasoning_msg}"
        sla_tier = "24-Hour Review"

    wallet = get_db_wallet_balance(patient_id)

    if status == "REJECTED":
        adjudication_mode = "AUTO_REJECT"
    elif policy_self_pay_required:
        adjudication_mode = "AUTO_SELF_PAY"
    elif ai_score >= 0.90:
        adjudication_mode = "AUTO_APPROVE"
    else:
        adjudication_mode = "MANUAL_REVIEW"

    response_data = {
        "payout_tier": sla_tier,
        "audit_score": round(ai_score, 2),
        "reasoning": final_reasoning,
        "clinical_indication": extracted_indication,
        "suggestions": ai_suggestions,
        "total_cost": total_cost,
        "hmo_payout": hmo_payout,
        "settlement_status": settlement_status,
        "benefit_bucket": benefit_bucket,
        "benefit_limit": benefit_limit,
        "benefit_used": round(benefit_used, 2),
        "benefit_remaining": round(max(0.0, benefit_remaining), 2),
        "requires_hmo_review": settlement_status == "PENDING_HMO_REVIEW",
        "adjudication_mode": adjudication_mode
    }

    if status == "REJECTED":
        response_data.update({
            "status": "REJECTED",
            "deducted": 0,
            "remaining": wallet,
            "new_wallet_balance": wallet,
            "message": "Claim denied by MediClaim Insurance Policy." if settlement_status == "HMO_POLICY_REJECTED" else "Claim automatically rejected by clinical audit rules."
        })
        return response_data

    # Out-of-pocket processing based on Hard Limits
    if wallet >= patient_owes:
        response_data.update({
            "status": status,
            "deducted": patient_owes,
            "remaining": 0,
            "new_wallet_balance": wallet - patient_owes,
            "message": "Self-pay authorized." if (hmo_payout <= 0 and patient_owes > 0) else "Authorized."
        })
    else:
        outstanding_amount = patient_owes - wallet
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
            "message": "Self-pay checkout required. Paycode generated." if (hmo_payout <= 0 and patient_owes > 0) else "Wallet exhausted. Paycode generated."
        })

    return response_data


# ============================================================
# DIAGNOSTIC ENDPOINT 
# ============================================================
@app.get("/api/v1/debug/nli-test")
async def nli_diagnostic_test():
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
    cursor.execute(
        '''
        INSERT OR REPLACE INTO clinical_queue (id, data)
        VALUES (?, ?)
        ''',
        (claim['id'], json.dumps(claim))
    )
    conn.commit()
    conn.close()

    sync_hmo_claim_snapshot(claim)
    sync_audit_row_from_queue_claim(claim)
    return {"status": "success"}

@app.delete("/api/v1/ehr/queue/{claim_id}")
async def delete_queue_item(claim_id: str):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    cursor.execute("DELETE FROM clinical_queue WHERE id = ?", (claim_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.get("/api/v1/hmo/claims")
async def get_hmo_claims():
    conn = sqlite3.connect('mediclaim_enterprise.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT claim_id, patient_id, doctor_name, procedure_name, status, ai_score,
               total_cost, hmo_payout, deducted_amount, paycode, clinical_indication,
               notes, ai_reasoning, messages_json, suggestions_json, resolved_by,
               settlement_status, updated_at
        FROM hmo_claims
        ORDER BY updated_at DESC
        '''
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    for row in rows:
        row['messages'] = json.loads(row.get('messages_json') or '[]')
        row['suggestions'] = json.loads(row.get('suggestions_json') or '[]')

    return rows

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
# CFO / ADMIN DASHBOARD ENDPOINTS
# ============================================================

@app.get("/api/v1/admin/hospital-wallet")
async def get_hospital_wallet():
    conn = sqlite3.connect('mediclaim_enterprise.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM hospital_wallet WHERE id = 'HW-001'")
    wallet = dict(cursor.fetchone())
    
    cursor.execute(
        """
        SELECT a.claim_id, a.patient_id, a.procedure_name, a.total_cost, a.deducted_amount,
               a.hmo_payout, a.settlement_status, a.timestamp, a.doctor_name, a.resolved_by,
               a.ai_score, a.paycode, a.status, a.reasoning, a.clinical_indication,
               h.notes, h.ai_reasoning, h.suggestions_json, h.messages_json
        FROM audit_ledger a
        LEFT JOIN hmo_claims h ON a.claim_id = h.claim_id
        ORDER BY a.timestamp DESC
        LIMIT 50
        """
    )
    recent_claims = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    return {"wallet": wallet, "recent_claims": recent_claims}

@app.post("/api/v1/admin/clear-pos-payment/{claim_id}")
async def clear_pos_payment(claim_id: str):
    conn = sqlite3.connect('mediclaim_enterprise.db')
    cursor = conn.cursor()
    
    cursor.execute("SELECT total_cost, deducted_amount, hmo_payout, paycode, settlement_status FROM audit_ledger WHERE claim_id = ?", (claim_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Claim not found")
        
    total_cost, deducted_amount, hmo_payout, paycode, settlement_status = row
    
    # 🌟 FIX: Calculate exact out-of-pocket balance instead of using 20% magic number
    out_of_pocket_total = total_cost - hmo_payout
    outstanding_balance = out_of_pocket_total - deducted_amount
    
    if outstanding_balance > 0 and paycode:
        cursor.execute("UPDATE hospital_wallet SET available_balance = available_balance + ? WHERE id = 'HW-001'", (outstanding_balance,))

        new_status = settlement_status
        if settlement_status == "HMO_APPROVED_PENDING_PT":
            cursor.execute("UPDATE hospital_wallet SET pending_escrow = pending_escrow - ?, available_balance = available_balance + ? WHERE id = 'HW-001'", (hmo_payout, hmo_payout))
            new_status = "FULLY_SETTLED"
        elif settlement_status == "PATIENT_RESPONSIBLE_PENDING_PT" or float(hmo_payout or 0) <= 0:
            new_status = "PATIENT_RESPONSIBLE_PAID"

        cursor.execute("UPDATE audit_ledger SET deducted_amount = ?, settlement_status = ? WHERE claim_id = ?", (out_of_pocket_total, new_status, claim_id))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "POS Cleared & Funds Released!"}
    
    conn.close()
    return {"status": "ignored"}