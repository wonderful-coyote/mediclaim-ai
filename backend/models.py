from pydantic import BaseModel
from typing import List, Optional

class Patient(BaseModel):
    id: str
    name: str
    gender: str
    virtual_account: str  # Linked to Interswitch Virtual Account
    wallet_balance: float # Current "Credit" on their hospital card

class ClinicalItem(BaseModel):
    code: str
    description: str
    category: str # e.g., "Radiology", "Laboratory", "Pharmacy"

class Doctor(BaseModel):
    id: str
    name: str
    rank: str # 'HO', 'MO', 'JR', 'SR', 'Consultant'
    department: str

class MedicalClaim(BaseModel):
    claim_id: str
    initiator_rank: str
    patient: Patient  
    hospital_id: str
    amount: float
    
    # --- EXISTING FIELDS FOR THE AI AUDITOR ---
    procedure_id: Optional[str] = None
    procedure_name: Optional[str] = None
    
    diagnosis_codes: Optional[List[dict]] = None
    clinical_notes: Optional[str] = None
    urgency_level: Optional[str] = None
    
    # --- NEW FINANCIAL FIELDS FOR HOSPITAL CFO DASHBOARD ---
    total_cost: float = 50000.0      # Total cost of the procedure
    patient_copay: float = 10000.0   # 20% paid via Interswitch
    hmo_payout: float = 40000.0      # 80% owed by HMO
    
    # --- THE STATE MACHINE TRACKER ---
    settlement_status: str = "PENDING_AI_AUDIT"
    # Valid States: 
    # "INSTANT_SETTLED"
    # "PENDING_CONSULTANT"
    # "PENDING_TIMER"
    # "HMO_AUDIT_REJECTED"
    # "SETTLED"

# --- NEW MODEL: The Hospital's Master Bank Account ---
class HospitalWallet(BaseModel):
    id: str = "HW-001"                   # Default ID for the master wallet
    available_balance: float = 1250000.0 # Starting cash for the demo
    pending_escrow: float = 0.0          # Money trapped in timers/approvals