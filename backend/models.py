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
    
    # --- NEW FIELDS FOR THE AI AUDITOR ---
    procedure_id: Optional[str] = None
    procedure_name: Optional[str] = None
    
    diagnosis_codes: Optional[List[dict]] = None
    clinical_notes: Optional[str] = None
    urgency_level: Optional[str] = None